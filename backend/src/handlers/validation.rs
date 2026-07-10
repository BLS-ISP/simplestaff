use axum::{extract::State, routing::post, Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::{AppError, ValidationWarning, WarningSeverity};
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::tenant;
use crate::services::validation_service;
use crate::AppState;

use sea_orm::EntityTrait;

#[derive(Debug, Deserialize)]
pub struct ValidateRequest {
    pub employee_id: Uuid,
    pub shift_type_id: Uuid,
    pub assignment_date: NaiveDate,
}

#[derive(Debug, Serialize)]
pub struct ValidateResponse {
    pub warnings: Vec<ValidationWarning>,
    pub is_valid: bool,
}

/// Registers the validation routes.
pub fn router() -> Router<AppState> {
    Router::new().route("/validate", post(validate_assignment))
}

/// POST /validate
///
/// Validates a proposed shift assignment against business rules and returns
/// any warnings. The response always succeeds (200 OK) — warnings are
/// informational, and the caller decides whether to proceed.
async fn validate_assignment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(payload): Json<ValidateRequest>,
) -> Result<Json<ValidateResponse>, AppError> {
    let db = &state.db;
    let tenant_id = auth_user.tenant_id;
    let employee_id = payload.employee_id;
    let shift_type_id = payload.shift_type_id;
    let assignment_date = payload.assignment_date;

    let warnings = execute_with_tenant(db, &tenant_id, |txn| {
        Box::pin(async move {
            // Load tenant settings
            let tenant_record = tenant::Entity::find_by_id(tenant_id)
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tenant not found".to_string()))?;

            let tenant_settings = tenant_record.settings;

            let warnings = validation_service::validate_assignment(
                txn,
                &tenant_id,
                &employee_id,
                &shift_type_id,
                &assignment_date,
                &tenant_settings,
            )
            .await?;

            Ok(warnings)
        })
    })
    .await?;

    let is_valid = !warnings
        .iter()
        .any(|w| matches!(w.severity, WarningSeverity::Critical));

    Ok(Json(ValidateResponse {
        warnings,
        is_valid,
    }))
}
