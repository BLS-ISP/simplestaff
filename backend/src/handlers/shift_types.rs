use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::shift_type::{self, ActiveModel, Column, Entity as ShiftType};
use crate::AppState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateShiftTypeInput {
    pub name: String,
    pub start_time: chrono::NaiveTime,
    pub end_time: chrono::NaiveTime,
    pub break_minutes: i32,
    pub color: String,
    pub valid_days: Option<serde_json::Value>,
    pub min_staff: Option<i32>,
    pub max_staff: Option<i32>,
    pub holiday_mode: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateShiftTypeInput {
    pub name: Option<String>,
    pub start_time: Option<chrono::NaiveTime>,
    pub end_time: Option<chrono::NaiveTime>,
    pub break_minutes: Option<i32>,
    pub color: Option<String>,
    pub is_active: Option<bool>,
    pub valid_days: Option<serde_json::Value>,
    pub min_staff: Option<Option<i32>>,
    pub max_staff: Option<Option<i32>>,
    pub holiday_mode: Option<String>,
}

#[derive(Serialize)]
pub struct ShiftTypeResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub name: String,
    pub start_time: chrono::NaiveTime,
    pub end_time: chrono::NaiveTime,
    pub break_minutes: i32,
    pub color: String,
    pub is_active: bool,
    pub valid_days: serde_json::Value,
    pub min_staff: Option<i32>,
    pub max_staff: Option<i32>,
    pub holiday_mode: String,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<shift_type::Model> for ShiftTypeResponse {
    fn from(m: shift_type::Model) -> Self {
        Self {
            id: m.id,
            tenant_id: m.tenant_id,
            name: m.name,
            start_time: m.start_time,
            end_time: m.end_time,
            break_minutes: m.break_minutes,
            color: m.color,
            is_active: m.is_active,
            valid_days: m.valid_days,
            min_staff: m.min_staff,
            max_staff: m.max_staff,
            holiday_mode: m.holiday_mode,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_manager(auth: &AuthUser) -> Result<(), AppError> {
    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => Ok(()),
        _ => Err(AppError::Forbidden("Manager access required".to_string())),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_shift_types).post(create_shift_type))
        .route("/{id}", axum::routing::put(update_shift_type).delete(delete_shift_type))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET / - List active shift types for the current tenant.
pub async fn list_shift_types(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ShiftTypeResponse>>, AppError> {
    let tenant_id = auth.tenant_id;

    let shift_types = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            ShiftType::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::IsActive.eq(true))
                .all(txn)
                .await
                .map_err(AppError::from)
        })
    })
    .await?;

    let response: Vec<ShiftTypeResponse> = shift_types.into_iter().map(Into::into).collect();
    Ok(Json(response))
}

/// POST / - Create a new shift type. Requires manager+ role.
pub async fn create_shift_type(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<CreateShiftTypeInput>,
) -> Result<Json<ShiftTypeResponse>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;
    let now = chrono::Utc::now().into();

    let shift_type = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let active_model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                name: Set(input.name),
                start_time: Set(input.start_time),
                end_time: Set(input.end_time),
                break_minutes: Set(input.break_minutes),
                color: Set(input.color),
                is_active: Set(true),
                valid_days: Set(input.valid_days.unwrap_or_else(|| serde_json::json!([1, 2, 3, 4, 5, 6, 7]))),
                min_staff: Set(input.min_staff),
                max_staff: Set(input.max_staff),
                holiday_mode: Set(input.holiday_mode.unwrap_or_else(|| "any_day".to_string())),
                created_at: Set(now),
                updated_at: Set(now),
            };

            active_model.insert(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(shift_type.into()))
}

/// PUT /:id - Update an existing shift type. Requires manager+ role.
pub async fn update_shift_type(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateShiftTypeInput>,
) -> Result<Json<ShiftTypeResponse>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;

    let shift_type = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = ShiftType::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

            let mut active_model: ActiveModel = existing.into();

            if let Some(name) = input.name {
                active_model.name = Set(name);
            }
            if let Some(start_time) = input.start_time {
                active_model.start_time = Set(start_time);
            }
            if let Some(end_time) = input.end_time {
                active_model.end_time = Set(end_time);
            }
            if let Some(break_minutes) = input.break_minutes {
                active_model.break_minutes = Set(break_minutes);
            }
            if let Some(color) = input.color {
                active_model.color = Set(color);
            }
            if let Some(is_active) = input.is_active {
                active_model.is_active = Set(is_active);
            }
            if let Some(valid_days) = input.valid_days {
                active_model.valid_days = Set(valid_days);
            }
            if let Some(min_staff) = input.min_staff {
                active_model.min_staff = Set(min_staff);
            }
            if let Some(max_staff) = input.max_staff {
                active_model.max_staff = Set(max_staff);
            }
            if let Some(holiday_mode) = input.holiday_mode {
                active_model.holiday_mode = Set(holiday_mode);
            }

            active_model.updated_at = Set(chrono::Utc::now().into());

            active_model.update(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(shift_type.into()))
}

/// DELETE /:id - Soft-delete a shift type (set is_active=false). Requires manager+ role.
pub async fn delete_shift_type(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = ShiftType::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

            let mut active_model: ActiveModel = existing.into();
            active_model.is_active = Set(false);
            active_model.updated_at = Set(chrono::Utc::now().into());

            active_model.update(txn).await?;
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "message": "Shift type deleted" })))
}
