use axum::{
    extract::{Path, State},
    Json,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::{AppError, WarningSeverity};
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::{employee, shift_assignment, shift_type, shift_swap, tenant, user};
use crate::services::validation_service;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct ShiftSwapResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub assignment_id: Uuid,
    pub requesting_employee_id: Uuid,
    pub requesting_employee_name: String,
    pub target_employee_id: Option<Uuid>,
    pub target_employee_name: Option<String>,
    pub backup_employee_id: Option<Uuid>,
    pub backup_employee_name: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
    // Shift details
    pub assignment_date: chrono::NaiveDate,
    pub shift_type_name: String,
    pub start_time: String,
    pub end_time: String,
    pub color: String,
}

/// GET /api/shift-swaps – list all shift swaps for the tenant
pub async fn list_shift_swaps(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ShiftSwapResponse>>, AppError> {
    let tenant_id = auth.tenant_id;

    let (swaps, employees, assignments, shift_types) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let s = shift_swap::Entity::find().filter(shift_swap::Column::TenantId.eq(tenant_id)).all(txn).await?;
            let emps = employee::Entity::find().filter(employee::Column::TenantId.eq(tenant_id)).all(txn).await?;
            let assigns = shift_assignment::Entity::find().filter(shift_assignment::Column::TenantId.eq(tenant_id)).all(txn).await?;
            let sts = shift_type::Entity::find().filter(shift_type::Column::TenantId.eq(tenant_id)).all(txn).await?;
            Ok((s, emps, assigns, sts))
        })
    })
    .await?;

    use std::collections::HashMap;
    let employee_map: HashMap<Uuid, employee::Model> = employees.into_iter().map(|e| (e.id, e)).collect();
    let assignment_map: HashMap<Uuid, shift_assignment::Model> = assignments.into_iter().map(|a| (a.id, a)).collect();
    let shift_type_map: HashMap<Uuid, shift_type::Model> = shift_types.into_iter().map(|st| (st.id, st)).collect();

    let response: Vec<ShiftSwapResponse> = swaps
        .into_iter()
        .map(|s| {
            let req_emp_name = if let Some(emp) = employee_map.get(&s.requesting_employee_id) {
                format!("{} {}", emp.first_name.as_deref().unwrap_or(""), emp.last_name.as_deref().unwrap_or("")).trim().to_string()
            } else {
                "Unbekannt".to_string()
            };

            let target_emp_name = s.target_employee_id.and_then(|id| {
                employee_map.get(&id).map(|emp| {
                    format!("{} {}", emp.first_name.as_deref().unwrap_or(""), emp.last_name.as_deref().unwrap_or("")).trim().to_string()
                })
            });

            let backup_emp_name = s.backup_employee_id.and_then(|id| {
                employee_map.get(&id).map(|emp| {
                    format!("{} {}", emp.first_name.as_deref().unwrap_or(""), emp.last_name.as_deref().unwrap_or("")).trim().to_string()
                })
            });

            let (assign_date, st_name, start_t, end_t, col) = if let Some(a) = assignment_map.get(&s.assignment_id) {
                let st = shift_type_map.get(&a.shift_type_id);
                (
                    a.assignment_date,
                    st.map(|x| x.name.clone()).unwrap_or_else(|| "Unbekannt".to_string()),
                    st.map(|x| x.start_time.format("%H:%M").to_string()).unwrap_or_else(|| "00:00".to_string()),
                    st.map(|x| x.end_time.format("%H:%M").to_string()).unwrap_or_else(|| "00:00".to_string()),
                    st.map(|x| x.color.clone()).unwrap_or_else(|| "#cccccc".to_string()),
                )
            } else {
                (
                    chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                    "Gelöschte Schicht".to_string(),
                    "00:00".to_string(),
                    "00:00".to_string(),
                    "#cccccc".to_string(),
                )
            };

            ShiftSwapResponse {
                id: s.id,
                tenant_id: s.tenant_id,
                assignment_id: s.assignment_id,
                requesting_employee_id: s.requesting_employee_id,
                requesting_employee_name: req_emp_name,
                target_employee_id: s.target_employee_id,
                target_employee_name: target_emp_name,
                backup_employee_id: s.backup_employee_id,
                backup_employee_name: backup_emp_name,
                status: s.status,
                notes: s.notes,
                created_at: s.created_at,
                updated_at: s.updated_at,
                assignment_date: assign_date,
                shift_type_name: st_name,
                start_time: start_t,
                end_time: end_t,
                color: col,
            }
        })
        .collect();

    Ok(Json(response))
}

#[derive(Deserialize)]
pub struct CreateSwapRequest {
    pub assignment_id: Uuid,
    pub target_employee_id: Option<Uuid>,
    pub notes: Option<String>,
}

/// POST /api/shift-swaps – release a shift for swap
pub async fn create_shift_swap(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateSwapRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;

    let requesting_employee_id = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let user_id = auth.user_id;
        let role = auth.role.clone();
        let assignment_id = payload.assignment_id;
        Box::pin(async move {
            let user_record = user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

            let emp = employee::Entity::find()
                .filter(employee::Column::TenantId.eq(tenant_id))
                .filter(employee::Column::Email.eq(user_record.email))
                .one(txn)
                .await?;

            let assignment = shift_assignment::Entity::find()
                .filter(shift_assignment::Column::Id.eq(assignment_id))
                .filter(shift_assignment::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Assignment not found".to_string()))?;

            if role == "viewer" {
                let current_emp = emp.ok_or_else(|| AppError::Forbidden("Mitarbeiterprofil nicht gefunden".to_string()))?;
                if assignment.employee_id != current_emp.id {
                    return Err(AppError::Forbidden("Sie können nur Ihre eigenen Schichten tauschen.".to_string()));
                }
                Ok(current_emp.id)
            } else {
                Ok(assignment.employee_id)
            }
        })
    })
    .await?;

    let new_swap = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let assignment_id = payload.assignment_id;
        let target_employee_id = payload.target_employee_id;
        let notes = payload.notes.clone();
        Box::pin(async move {
            let existing = shift_swap::Entity::find()
                .filter(shift_swap::Column::TenantId.eq(tenant_id))
                .filter(shift_swap::Column::AssignmentId.eq(assignment_id))
                .filter(shift_swap::Column::Status.ne("approved"))
                .filter(shift_swap::Column::Status.ne("cancelled"))
                .one(txn)
                .await?;
            if existing.is_some() {
                return Err(AppError::BadRequest("Diese Schicht befindet sich bereits in der Tauschbörse.".to_string()));
            }

            let model = shift_swap::ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                assignment_id: Set(assignment_id),
                requesting_employee_id: Set(requesting_employee_id),
                target_employee_id: Set(target_employee_id),
                backup_employee_id: Set(None),
                status: Set("open".to_string()),
                notes: Set(notes),
                created_at: Set(chrono::Utc::now().into()),
                updated_at: Set(chrono::Utc::now().into()),
            };

            let inserted = model.insert(txn).await?;
            Ok(inserted)
        })
    })
    .await?;

    Ok(Json(serde_json::to_value(new_swap).unwrap()))
}

/// PUT /api/shift-swaps/{id}/claim – apply to take over this shift
pub async fn claim_shift_swap(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(swap_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;

    let claiming_employee_id = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let user_id = auth.user_id;
        Box::pin(async move {
            let user_record = user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

            let emp = employee::Entity::find()
                .filter(employee::Column::TenantId.eq(tenant_id))
                .filter(employee::Column::Email.eq(user_record.email))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::Forbidden("Für Ihr Konto wurde kein Mitarbeiterprofil gefunden. Sie können keine Schichten übernehmen.".to_string()))?;
            Ok(emp.id)
        })
    })
    .await?;

    let updated = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let swap = shift_swap::Entity::find()
                .filter(shift_swap::Column::Id.eq(swap_id))
                .filter(shift_swap::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tauschantrag nicht gefunden".to_string()))?;

            if swap.status != "open" {
                return Err(AppError::BadRequest("Dieser Schichttausch ist nicht mehr offen.".to_string()));
            }

            if swap.requesting_employee_id == claiming_employee_id {
                return Err(AppError::BadRequest("Sie können Ihre eigene Schicht nicht übernehmen.".to_string()));
            }

            if let Some(target_id) = swap.target_employee_id {
                if target_id != claiming_employee_id {
                    return Err(AppError::Forbidden("Dieser Tausch ist direkt an einen anderen Kollegen adressiert.".to_string()));
                }
            }

            let mut active: shift_swap::ActiveModel = swap.into();
            active.backup_employee_id = Set(Some(claiming_employee_id));
            active.status = Set("proposed".to_string());
            active.updated_at = Set(chrono::Utc::now().into());

            let res = active.update(txn).await?;
            Ok(res)
        })
    })
    .await?;

    Ok(Json(serde_json::to_value(updated).unwrap()))
}

/// PUT /api/shift-swaps/{id}/approve – planner approves the swap
pub async fn approve_shift_swap(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(swap_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;

    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => {}
        _ => return Err(AppError::Forbidden("Manager access required".to_string())),
    }

    let updated_assignment = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let swap = shift_swap::Entity::find()
                .filter(shift_swap::Column::Id.eq(swap_id))
                .filter(shift_swap::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tauschantrag nicht gefunden".to_string()))?;

            if swap.status != "proposed" {
                return Err(AppError::BadRequest("Der Tauschantrag befindet sich nicht im Status 'proposed'.".to_string()));
            }

            let backup_employee_id = swap.backup_employee_id
                .ok_or_else(|| AppError::BadRequest("Kein Übernahme-Kandidat vorhanden.".to_string()))?;

            let assignment = shift_assignment::Entity::find()
                .filter(shift_assignment::Column::Id.eq(swap.assignment_id))
                .filter(shift_assignment::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Zugehörige Schichtzuweisung nicht gefunden.".to_string()))?;

            let tenant_record = tenant::Entity::find_by_id(tenant_id)
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tenant not found".to_string()))?;

            let warnings = validation_service::validate_assignment(
                txn,
                &tenant_id,
                &backup_employee_id,
                &assignment.shift_type_id,
                &assignment.assignment_date,
                &tenant_record.settings,
            )
            .await?;

            let has_critical = warnings
                .iter()
                .any(|w| matches!(w.severity, WarningSeverity::Critical));
            if has_critical {
                let msg = warnings
                    .iter()
                    .filter(|w| matches!(w.severity, WarningSeverity::Critical))
                    .map(|w| w.message_de.clone())
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(AppError::BadRequest(format!("Tausch verletzt Dienstplanregeln: {}", msg)));
            }

            let mut active_assign: shift_assignment::ActiveModel = assignment.into();
            active_assign.employee_id = Set(backup_employee_id);
            active_assign.updated_at = Set(chrono::Utc::now().into());
            let updated_assign = active_assign.update(txn).await?;

            let mut active_swap: shift_swap::ActiveModel = swap.into();
            active_swap.status = Set("approved".to_string());
            active_swap.updated_at = Set(chrono::Utc::now().into());
            active_swap.update(txn).await?;

            Ok(updated_assign)
        })
    })
    .await?;

    Ok(Json(serde_json::to_value(updated_assignment).unwrap()))
}

/// PUT /api/shift-swaps/{id}/reject – planner rejects the swap (reverts swap to open)
pub async fn reject_shift_swap(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(swap_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;

    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => {}
        _ => return Err(AppError::Forbidden("Manager access required".to_string())),
    }

    let updated = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let swap = shift_swap::Entity::find()
                .filter(shift_swap::Column::Id.eq(swap_id))
                .filter(shift_swap::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tauschantrag nicht gefunden".to_string()))?;

            if swap.status != "proposed" {
                return Err(AppError::BadRequest("Der Tauschantrag kann nur abgelehnt werden, wenn er vorgeschlagen wurde.".to_string()));
            }

            let mut active: shift_swap::ActiveModel = swap.into();
            active.backup_employee_id = Set(None);
            active.status = Set("open".to_string());
            active.updated_at = Set(chrono::Utc::now().into());

            let res = active.update(txn).await?;
            Ok(res)
        })
    })
    .await?;

    Ok(Json(serde_json::to_value(updated).unwrap()))
}

/// DELETE /api/shift-swaps/{id} – cancel swap offer (requesting employee cancels)
pub async fn delete_shift_swap(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(swap_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        let role = auth.role.clone();
        let user_id = auth.user_id;
        Box::pin(async move {
            let swap = shift_swap::Entity::find_by_id(swap_id)
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tauschantrag nicht gefunden".to_string()))?;

            if swap.status == "approved" {
                return Err(AppError::BadRequest("Bereits genehmigte Tauschanträge können nicht storniert werden.".to_string()));
            }

            if role == "viewer" {
                let user_record = user::Entity::find()
                    .filter(user::Column::Id.eq(user_id))
                    .filter(user::Column::TenantId.eq(tenant_id))
                    .one(txn)
                    .await?
                    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

                let emp = employee::Entity::find()
                    .filter(employee::Column::TenantId.eq(tenant_id))
                    .filter(employee::Column::Email.eq(user_record.email))
                    .one(txn)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("Mitarbeiterprofil nicht gefunden".to_string()))?;

                if swap.requesting_employee_id != emp.id {
                    return Err(AppError::Forbidden("Sie können nur Ihre eigenen Anträge stornieren.".to_string()));
                }
            }

            shift_swap::Entity::delete_many()
                .filter(shift_swap::Column::Id.eq(swap_id))
                .filter(shift_swap::Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "success": true, "message": "Tauschantrag storniert." })))
}
