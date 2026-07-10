use axum::{
    extract::{Path, State},
    Json,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, ModelTrait, QueryFilter, QueryOrder, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::{auth::AuthUser, tenant::execute_with_tenant},
    models::employee_blocked_day::{self, ActiveModel, Column, Entity as BlockedDay},
    AppState,
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateBlockedDayRequest {
    pub blocked_date: chrono::NaiveDate,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BlockedDayResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub employee_id: Uuid,
    pub blocked_date: chrono::NaiveDate,
    pub reason: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<employee_blocked_day::Model> for BlockedDayResponse {
    fn from(model: employee_blocked_day::Model) -> Self {
        Self {
            id: model.id,
            tenant_id: model.tenant_id,
            employee_id: model.employee_id,
            blocked_date: model.blocked_date,
            reason: model.reason,
            created_at: model.created_at,
        }
    }
}

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /employees/:employee_id/blocked-days
pub async fn list_blocked_days(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(employee_id): Path<Uuid>,
) -> Result<Json<Vec<BlockedDayResponse>>, AppError> {
    let blocked_days = execute_with_tenant(&state.db, &auth_user.tenant_id, |txn| {
        Box::pin(async move {
            BlockedDay::find()
                .filter(Column::EmployeeId.eq(employee_id))
                .order_by_asc(Column::BlockedDate)
                .all(txn)
                .await
                .map_err(AppError::from)
        })
    })
    .await?;

    let response: Vec<BlockedDayResponse> = blocked_days.into_iter().map(Into::into).collect();
    Ok(Json(response))
}

/// POST /employees/:employee_id/blocked-days
pub async fn create_blocked_day(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(employee_id): Path<Uuid>,
    Json(payload): Json<CreateBlockedDayRequest>,
) -> Result<Json<BlockedDayResponse>, AppError> {
    let tenant_id = auth_user.tenant_id;

    let blocked_day = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let active_model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                employee_id: Set(employee_id),
                blocked_date: Set(payload.blocked_date),
                reason: Set(payload.reason),
                created_at: Set(chrono::Utc::now().into()),
            };

            active_model.insert(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(blocked_day.into()))
}

/// DELETE /employees/:employee_id/blocked-days/:id
pub async fn delete_blocked_day(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((employee_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    execute_with_tenant(&state.db, &auth_user.tenant_id, |txn| {
        Box::pin(async move {
            let blocked_day = BlockedDay::find_by_id(id)
                .filter(Column::EmployeeId.eq(employee_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Blocked day not found".to_string()))?;

            blocked_day.delete(txn).await?;
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}
