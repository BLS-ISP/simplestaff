use axum::{
    extract::{Path, Query, State},
    routing::{get, put},
    Json, Router,
};
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::shift_assignment::{self, ActiveModel, Column, Entity as ShiftAssignment};
use crate::AppState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListQuery {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateAssignment {
    pub employee_id: Uuid,
    pub shift_type_id: Uuid,
    pub assignment_date: NaiveDate,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateAssignment {
    pub employee_id: Option<Uuid>,
    pub shift_type_id: Option<Uuid>,
    pub assignment_date: Option<NaiveDate>,
    pub actual_start: Option<NaiveTime>,
    pub actual_end: Option<NaiveTime>,
    pub actual_break_minutes: Option<i32>,
    pub status: Option<String>,
    pub notes: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn week_range(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    let weekday = date.weekday().num_days_from_monday();
    let monday = date - Duration::days(weekday as i64);
    let sunday = monday + Duration::days(6);
    (monday, sunday)
}

fn month_range(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    let first = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap();
    let last = if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap() - Duration::days(1)
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap() - Duration::days(1)
    };
    (first, last)
}

/// Fetch assignments within a date range (inclusive) under tenant RLS.
async fn fetch_assignments_in_range(
    state: &AppState,
    tenant_id: &Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Vec<shift_assignment::Model>, AppError> {
    let tenant_id_val = *tenant_id;
    execute_with_tenant(&state.db, &tenant_id_val, |txn| {
        Box::pin(async move {
            ShiftAssignment::find()
                .filter(Column::TenantId.eq(tenant_id_val))
                .filter(Column::AssignmentDate.gte(start))
                .filter(Column::AssignmentDate.lte(end))
                .order_by_asc(Column::AssignmentDate)
                .all(txn)
                .await
                .map_err(AppError::from)
        })
    })
    .await
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

fn require_manager(auth: &AuthUser) -> Result<(), AppError> {
    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => Ok(()),
        _ => Err(AppError::Forbidden("Manager access required".to_string())),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_assignments).post(create_assignment))
        .route("/week/{date}", get(get_week))
        .route("/month/{date}", get(get_month))
        .route("/auto-schedule", axum::routing::post(auto_schedule))
        .route("/copy-week", axum::routing::post(copy_week))
        .route("/{id}/mark-sick", axum::routing::post(mark_sick))
        .route("/{id}", put(update_assignment).delete(delete_assignment))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET / — list assignments with optional start_date / end_date query params.
/// Defaults to the current week (Monday–Sunday) when no params are provided.
pub async fn list_assignments(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<shift_assignment::Model>>, AppError> {
    let (start, end) = match (query.start_date, query.end_date) {
        (Some(s), Some(e)) => (s, e),
        _ => {
            let today = Local::now().date_naive();
            week_range(today)
        }
    };

    let assignments = fetch_assignments_in_range(&state, &auth_user.tenant_id, start, end).await?;
    Ok(Json(assignments))
}

/// GET /week/:date — all assignments for the ISO week containing `:date`.
pub async fn get_week(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(date): Path<NaiveDate>,
) -> Result<Json<Vec<shift_assignment::Model>>, AppError> {
    let (start, end) = week_range(date);
    let assignments = fetch_assignments_in_range(&state, &auth_user.tenant_id, start, end).await?;
    Ok(Json(assignments))
}

/// GET /month/:date — all assignments for the calendar month of `:date`.
pub async fn get_month(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(date): Path<NaiveDate>,
) -> Result<Json<Vec<shift_assignment::Model>>, AppError> {
    let (start, end) = month_range(date);
    let assignments = fetch_assignments_in_range(&state, &auth_user.tenant_id, start, end).await?;
    Ok(Json(assignments))
}

/// POST / — create a new assignment with status `planned`.
pub async fn create_assignment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<CreateAssignment>,
) -> Result<Json<shift_assignment::Model>, AppError> {
    require_manager(&auth_user)?;

    let tenant_id = auth_user.tenant_id;
    let now = chrono::Utc::now().into();

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let emp_exists = crate::models::employee::Entity::find()
                .filter(crate::models::employee::Column::Id.eq(body.employee_id))
                .filter(crate::models::employee::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .is_some();
            if !emp_exists {
                return Err(AppError::NotFound("Employee not found in tenant".to_string()));
            }

            let st_exists = crate::models::shift_type::Entity::find()
                .filter(crate::models::shift_type::Column::Id.eq(body.shift_type_id))
                .filter(crate::models::shift_type::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .is_some();
            if !st_exists {
                return Err(AppError::NotFound("Shift type not found in tenant".to_string()));
            }

            let active = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                employee_id: Set(body.employee_id),
                shift_type_id: Set(body.shift_type_id),
                assignment_date: Set(body.assignment_date),
                actual_start: Set(None),
                actual_end: Set(None),
                actual_break_minutes: Set(None),
                status: Set("planned".to_string()),
                notes: Set(body.notes),
                created_at: Set(now),
                updated_at: Set(now),
            };

            active.insert(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(model))
}

/// PUT /:id — update an existing assignment (partial update).
pub async fn update_assignment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateAssignment>,
) -> Result<Json<shift_assignment::Model>, AppError> {
    require_manager(&auth_user)?;

    let tenant_id = auth_user.tenant_id;

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = ShiftAssignment::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Assignment {id} not found")))?;

            let mut active: ActiveModel = existing.into();

            if let Some(employee_id) = body.employee_id {
                let emp_exists = crate::models::employee::Entity::find()
                    .filter(crate::models::employee::Column::Id.eq(employee_id))
                    .filter(crate::models::employee::Column::TenantId.eq(tenant_id))
                    .one(txn)
                    .await?
                    .is_some();
                if !emp_exists {
                    return Err(AppError::NotFound("Employee not found in tenant".to_string()));
                }
                active.employee_id = Set(employee_id);
            }
            if let Some(shift_type_id) = body.shift_type_id {
                let st_exists = crate::models::shift_type::Entity::find()
                    .filter(crate::models::shift_type::Column::Id.eq(shift_type_id))
                    .filter(crate::models::shift_type::Column::TenantId.eq(tenant_id))
                    .one(txn)
                    .await?
                    .is_some();
                if !st_exists {
                    return Err(AppError::NotFound("Shift type not found in tenant".to_string()));
                }
                active.shift_type_id = Set(shift_type_id);
            }
            if let Some(assignment_date) = body.assignment_date {
                active.assignment_date = Set(assignment_date);
            }
            if let Some(actual_start) = body.actual_start {
                active.actual_start = Set(Some(actual_start));
            }
            if let Some(actual_end) = body.actual_end {
                active.actual_end = Set(Some(actual_end));
            }
            if let Some(actual_break_minutes) = body.actual_break_minutes {
                active.actual_break_minutes = Set(Some(actual_break_minutes));
            }
            if let Some(ref status) = body.status {
                active.status = Set(status.clone());
            }
            if let Some(ref notes) = body.notes {
                active.notes = Set(Some(notes.clone()));
            }

            active.updated_at = Set(chrono::Utc::now().into());

            active.update(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(model))
}

/// DELETE /:id — hard-delete an assignment.
pub async fn delete_assignment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth_user)?;

    let tenant_id = auth_user.tenant_id;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let result = ShiftAssignment::delete_many()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;

            if result.rows_affected == 0 {
                return Err(AppError::NotFound(format!("Assignment {id} not found")));
            }

            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "deleted": true, "id": id })))
}

#[derive(Deserialize)]
pub struct AutoScheduleInput {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

/// POST /auto-schedule — automatically populate schedule for range [start_date, end_date].
pub async fn auto_schedule(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<AutoScheduleInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth_user)?;

    let today = chrono::Local::now().date_naive();
    if body.start_date < today {
        return Err(AppError::BadRequest("Dienstpläne in der Vergangenheit dürfen nicht automatisch besetzt werden.".to_string()));
    }
    if body.end_date < body.start_date {
        return Err(AppError::BadRequest("Das Enddatum darf nicht vor dem Startdatum liegen.".to_string()));
    }

    crate::services::scheduler_service::run_auto_schedule(
        &state.db,
        &auth_user.tenant_id,
        body.start_date,
        body.end_date,
    )
    .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Dienstplan wurde erfolgreich automatisch besetzt."
    })))
}

#[derive(Deserialize)]
pub struct CopyWeekInput {
    pub source_monday: NaiveDate,
    pub target_monday: NaiveDate,
}

/// POST /copy-week — copies non-sick assignments from source week to target week,
/// skipping closed days, approved vacations, blocked days, and already assigned employees.
pub async fn copy_week(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<CopyWeekInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth_user)?;

    if body.source_monday == body.target_monday {
        return Err(AppError::BadRequest(
            "Quell- und Zielwoche dürfen nicht identisch sein.".to_string(),
        ));
    }

    let tenant_id = auth_user.tenant_id;
    let source_start = body.source_monday;
    let source_end = source_start + Duration::days(6);
    let target_start = body.target_monday;
    let target_end = target_start + Duration::days(6);
    let now = chrono::Utc::now().into();

    let (copied_count, skipped_count) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let source_assignments = ShiftAssignment::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::AssignmentDate.gte(source_start))
                .filter(Column::AssignmentDate.lte(source_end))
                .filter(Column::Status.ne("sick"))
                .all(txn)
                .await?;

            let target_assignments = ShiftAssignment::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::AssignmentDate.gte(target_start))
                .filter(Column::AssignmentDate.lte(target_end))
                .filter(Column::Status.ne("sick"))
                .all(txn)
                .await?;

            let active_employees = crate::models::employee::Entity::find()
                .filter(crate::models::employee::Column::TenantId.eq(tenant_id))
                .filter(crate::models::employee::Column::IsActive.eq(true))
                .all(txn)
                .await?;
            let active_emp_ids: std::collections::HashSet<Uuid> =
                active_employees.into_iter().map(|e| e.id).collect();

            let vacations = crate::models::employee_vacation::Entity::find()
                .filter(crate::models::employee_vacation::Column::TenantId.eq(tenant_id))
                .filter(crate::models::employee_vacation::Column::Status.eq("approved"))
                .filter(crate::models::employee_vacation::Column::StartDate.lte(target_end))
                .filter(crate::models::employee_vacation::Column::EndDate.gte(target_start))
                .all(txn)
                .await?;

            let blocked_days = crate::models::employee_blocked_day::Entity::find()
                .filter(crate::models::employee_blocked_day::Column::TenantId.eq(tenant_id))
                .filter(crate::models::employee_blocked_day::Column::BlockedDate.gte(target_start))
                .filter(crate::models::employee_blocked_day::Column::BlockedDate.lte(target_end))
                .all(txn)
                .await?;

            let closed_days = crate::models::closed_day::Entity::find()
                .filter(crate::models::closed_day::Column::TenantId.eq(tenant_id))
                .filter(crate::models::closed_day::Column::ClosedDate.gte(target_start))
                .filter(crate::models::closed_day::Column::ClosedDate.lte(target_end))
                .all(txn)
                .await?;

            let mut existing_emp_dates: std::collections::HashSet<(Uuid, NaiveDate)> =
                target_assignments
                    .into_iter()
                    .map(|a| (a.employee_id, a.assignment_date))
                    .collect();

            let mut copied = 0usize;
            let mut skipped = 0usize;

            for src in source_assignments {
                let offset_days = (src.assignment_date - source_start).num_days();
                let target_date = target_start + Duration::days(offset_days);

                if !active_emp_ids.contains(&src.employee_id) {
                    skipped += 1;
                    continue;
                }

                let is_company_closed = closed_days
                    .iter()
                    .any(|cd| cd.closed_date == target_date && !cd.is_holiday);
                if is_company_closed {
                    skipped += 1;
                    continue;
                }

                let on_vacation = vacations.iter().any(|v| {
                    v.employee_id == src.employee_id
                        && target_date >= v.start_date
                        && target_date <= v.end_date
                });
                if on_vacation {
                    skipped += 1;
                    continue;
                }

                let is_blocked = blocked_days.iter().any(|b| {
                    b.employee_id == src.employee_id && b.blocked_date == target_date
                });
                if is_blocked {
                    skipped += 1;
                    continue;
                }

                if existing_emp_dates.contains(&(src.employee_id, target_date)) {
                    skipped += 1;
                    continue;
                }

                let new_active = ActiveModel {
                    id: Set(Uuid::new_v4()),
                    tenant_id: Set(tenant_id),
                    employee_id: Set(src.employee_id),
                    shift_type_id: Set(src.shift_type_id),
                    assignment_date: Set(target_date),
                    actual_start: Set(None),
                    actual_end: Set(None),
                    actual_break_minutes: Set(None),
                    status: Set("planned".to_string()),
                    notes: Set(src.notes),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                new_active.insert(txn).await?;
                existing_emp_dates.insert((src.employee_id, target_date));
                copied += 1;
            }

            Ok((copied, skipped))
        })
    })
    .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "copied_count": copied_count,
        "skipped_count": skipped_count,
    })))
}

/// POST /:id/mark-sick — marks an assignment as `sick` and creates an open shift swap request.
pub async fn mark_sick(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<shift_assignment::Model>, AppError> {
    require_manager(&auth_user)?;

    let tenant_id = auth_user.tenant_id;
    let now = chrono::Utc::now().into();

    let updated = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = ShiftAssignment::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Assignment {id} not found")))?;

            let emp_id = existing.employee_id;
            let current_notes = existing.notes.clone();

            let mut active: ActiveModel = existing.into();
            active.status = Set("sick".to_string());
            if current_notes.as_deref().unwrap_or("").trim().is_empty() {
                active.notes = Set(Some("Krankgemeldet".to_string()));
            }
            active.updated_at = Set(now);
            let updated_model = active.update(txn).await?;

            // Create an open shift_swap if none exists for this assignment
            let existing_swap = crate::models::shift_swap::Entity::find()
                .filter(crate::models::shift_swap::Column::TenantId.eq(tenant_id))
                .filter(crate::models::shift_swap::Column::AssignmentId.eq(id))
                .filter(
                    crate::models::shift_swap::Column::Status
                        .is_in(["open", "proposed"]),
                )
                .one(txn)
                .await?;

            if existing_swap.is_none() {
                let swap_model = crate::models::shift_swap::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    tenant_id: Set(tenant_id),
                    assignment_id: Set(id),
                    requesting_employee_id: Set(emp_id),
                    target_employee_id: Set(None),
                    backup_employee_id: Set(None),
                    status: Set("open".to_string()),
                    notes: Set(Some("Krankmeldung – Vertretung gesucht".to_string())),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                swap_model.insert(txn).await?;
            }

            Ok(updated_model)
        })
    })
    .await?;

    Ok(Json(updated))
}
