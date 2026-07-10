use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::NaiveDate;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::closed_day::{self, ActiveModel, Column, Entity as ClosedDay};
use crate::AppState;

#[derive(Deserialize)]
pub struct ListQuery {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateClosedDayInput {
    pub closed_date: NaiveDate,
    pub description: String,
    pub is_holiday: bool,
}

fn require_manager(auth: &AuthUser) -> Result<(), AppError> {
    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => Ok(()),
        _ => Err(AppError::Forbidden("Manager access required".to_string())),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_closed_days).post(create_closed_day))
        .route("/{id}", axum::routing::delete(delete_closed_day))
}

pub async fn list_closed_days(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<closed_day::Model>>, AppError> {
    let tenant_id = auth.tenant_id;

    let closed_days = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let mut q = ClosedDay::find()
                .filter(Column::TenantId.eq(tenant_id))
                .order_by_asc(Column::ClosedDate);

            if let Some(start) = query.start_date {
                q = q.filter(Column::ClosedDate.gte(start));
            }
            if let Some(end) = query.end_date {
                q = q.filter(Column::ClosedDate.lte(end));
            }

            q.all(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(closed_days))
}

pub async fn create_closed_day(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<CreateClosedDayInput>,
) -> Result<Json<closed_day::Model>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;
    let now = chrono::Utc::now().fixed_offset();

    let closed_day = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            // Check if closed day already exists for this date
            let existing = ClosedDay::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::ClosedDate.eq(input.closed_date))
                .one(txn)
                .await?;

            if existing.is_some() {
                return Err(AppError::BadRequest("Für dieses Datum existiert bereits ein Eintrag.".to_string()));
            }

            let active_model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                closed_date: Set(input.closed_date),
                description: Set(input.description),
                is_holiday: Set(input.is_holiday),
                created_at: Set(now),
                updated_at: Set(now),
            };

            active_model.insert(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(closed_day))
}

pub async fn delete_closed_day(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let delete_res = ClosedDay::delete_many()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;
            if delete_res.rows_affected == 0 {
                return Err(AppError::NotFound(format!("Closed day {id} not found")));
            }
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "success": true, "message": "Eintrag erfolgreich gelöscht." })))
}
