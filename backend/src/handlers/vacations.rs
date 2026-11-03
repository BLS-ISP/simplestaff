use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{Datelike, NaiveDate};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::collections::HashMap;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::closed_day;
use crate::models::employee;
use crate::models::employee_vacation::{self, ActiveModel, Column, Entity as Vacation};
use crate::models::user;
use crate::AppState;
use std::collections::HashSet;

fn count_vacation_days(
    start_date: NaiveDate,
    end_date: NaiveDate,
    closed_dates: &HashSet<NaiveDate>,
) -> f32 {
    let mut count = 0.0;
    let mut curr = start_date;
    while curr <= end_date {
        let wd = curr.weekday().number_from_monday();
        if wd <= 5 && !closed_dates.contains(&curr) {
            count += 1.0;
        }
        if let Some(next) = curr.succ_opt() {
            curr = next;
        } else {
            break;
        }
    }
    count
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateVacationRequest {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VacationResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub employee_id: Uuid,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<employee_vacation::Model> for VacationResponse {
    fn from(m: employee_vacation::Model) -> Self {
        Self {
            id: m.id,
            tenant_id: m.tenant_id,
            employee_id: m.employee_id,
            start_date: m.start_date,
            end_date: m.end_date,
            status: m.status,
            notes: m.notes,
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

async fn verify_employee_access(
    txn: &sea_orm::DatabaseTransaction,
    auth: &AuthUser,
    employee_id: Uuid,
) -> Result<employee::Model, AppError> {
    let emp = employee::Entity::find()
        .filter(employee::Column::Id.eq(employee_id))
        .filter(employee::Column::TenantId.eq(auth.tenant_id))
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Employee not found".to_string()))?;

    if !matches!(auth.role.as_str(), "super_admin" | "admin" | "planner") {
        let user_model = user::Entity::find()
            .filter(user::Column::Id.eq(auth.user_id))
            .filter(user::Column::TenantId.eq(auth.tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        let emp_email = emp.email.clone().unwrap_or_default();
        if emp_email.trim().is_empty()
            || !emp_email.trim().eq_ignore_ascii_case(user_model.email.trim())
        {
            return Err(AppError::Forbidden(
                "Sie dürfen nur auf Ihre eigenen Urlaubsanträge zugreifen.".to_string(),
            ));
        }
    }

    Ok(emp)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /employees/:employee_id/vacations
pub async fn list_vacations(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(employee_id): Path<Uuid>,
) -> Result<Json<Vec<VacationResponse>>, AppError> {
    let vacations = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        let auth_clone = auth.clone();
        Box::pin(async move {
            verify_employee_access(txn, &auth_clone, employee_id).await?;

            Vacation::find()
                .filter(Column::TenantId.eq(auth_clone.tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .order_by_desc(Column::StartDate)
                .all(txn)
                .await
                .map_err(AppError::from)
        })
    })
    .await?;

    let response: Vec<VacationResponse> = vacations.into_iter().map(VacationResponse::from).collect();
    Ok(Json(response))
}

/// POST /employees/:employee_id/vacations
pub async fn create_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(employee_id): Path<Uuid>,
    Json(body): Json<CreateVacationRequest>,
) -> Result<Json<VacationResponse>, AppError> {
    if body.end_date < body.start_date {
        return Err(AppError::BadRequest(
            "end_date must not be before start_date".to_string(),
        ));
    }

    let now = chrono::Utc::now().into();
    let tenant_id = auth.tenant_id;
    let notes_for_mail = body.notes.clone();

    let (vacation, manager_emails, emp_name) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let auth_clone = auth.clone();
        Box::pin(async move {
            let emp = verify_employee_access(txn, &auth_clone, employee_id).await?;

            // Prevent overlapping requested or approved vacations for the same employee
            let overlapping = Vacation::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .filter(Column::Status.is_in(["requested", "approved"]))
                .filter(Column::StartDate.lte(body.end_date))
                .filter(Column::EndDate.gte(body.start_date))
                .one(txn)
                .await?;
            if overlapping.is_some() {
                return Err(AppError::Conflict(
                    "In diesem Zeitraum existiert bereits ein beantragter oder genehmigter Urlaub.".to_string(),
                ));
            }

            let first = emp.first_name.clone().unwrap_or_default();
            let last = emp.last_name.clone().unwrap_or_default();
            let full_name = format!("{} {}", first, last).trim().to_string();

            let model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                employee_id: Set(employee_id),
                start_date: Set(body.start_date),
                end_date: Set(body.end_date),
                status: Set("requested".to_string()),
                notes: Set(body.notes),
                created_at: Set(now),
                updated_at: Set(now),
            };

            let inserted = model.insert(txn).await?;

            // Fetch manager/admin emails for notification
            let managers = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .filter(user::Column::IsActive.eq(true))
                .all(txn)
                .await?;

            let manager_emails: Vec<String> = managers
                .into_iter()
                .filter(|u| u.role == "admin" || u.role == "planner" || u.role == "super_admin")
                .map(|u| u.email)
                .collect();

            Ok((inserted, manager_emails, full_name))
        })
    })
    .await?;

    // Send email notification to managers
    crate::services::email_service::notify_vacation_requested(
        state.config.clone(),
        manager_emails,
        emp_name,
        vacation.start_date.format("%d.%m.%Y").to_string(),
        vacation.end_date.format("%d.%m.%Y").to_string(),
        notes_for_mail,
    );

    Ok(Json(VacationResponse::from(vacation)))
}

/// PUT /employees/:employee_id/vacations/:id/approve
pub async fn approve_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((employee_id, vacation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<VacationResponse>, AppError> {
    require_manager(&auth)?;

    let (vacation, emp_email, emp_name, status_changed) = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let vacation = Vacation::find()
                .filter(Column::Id.eq(vacation_id))
                .filter(Column::TenantId.eq(auth.tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Vacation not found".to_string()))?;

            let previous_status = vacation.status.clone();
            let status_changed = previous_status != "approved";

            let mut active: ActiveModel = vacation.into();
            active.status = Set("approved".to_string());
            active.updated_at = Set(chrono::Utc::now().into());
            let updated_vacation = active.update(txn).await?;

            let mut emp_email = String::new();
            let mut emp_name = String::new();

            if let Some(emp) = employee::Entity::find()
                .filter(employee::Column::Id.eq(employee_id))
                .filter(employee::Column::TenantId.eq(auth.tenant_id))
                .one(txn)
                .await?
            {
                emp_email = emp.email.clone().unwrap_or_default();
                let first = emp.first_name.clone().unwrap_or_default();
                let last = emp.last_name.clone().unwrap_or_default();
                emp_name = format!("{} {}", first, last).trim().to_string();

                // If it wasn't already approved, deduct the vacation days from employee balance
                if status_changed {
                    let closed_list = closed_day::Entity::find()
                        .filter(closed_day::Column::TenantId.eq(auth.tenant_id))
                        .filter(closed_day::Column::ClosedDate.gte(updated_vacation.start_date))
                        .filter(closed_day::Column::ClosedDate.lte(updated_vacation.end_date))
                        .all(txn)
                        .await?;
                    let closed_dates: HashSet<NaiveDate> =
                        closed_list.into_iter().map(|c| c.closed_date).collect();

                    let days = count_vacation_days(
                        updated_vacation.start_date,
                        updated_vacation.end_date,
                        &closed_dates,
                    );
                    let mut active_emp: employee::ActiveModel = emp.into();
                    let new_remaining = active_emp.vacation_days_remaining.unwrap() - days;
                    active_emp.vacation_days_remaining = Set(new_remaining);
                    active_emp.updated_at = Set(chrono::Utc::now().into());
                    active_emp.update(txn).await?;
                }
            }

            Ok((updated_vacation, emp_email, emp_name, status_changed))
        })
    })
    .await?;

    if status_changed && !emp_email.trim().is_empty() {
        crate::services::email_service::notify_vacation_decided(
            state.config.clone(),
            emp_email,
            emp_name,
            "approved".to_string(),
            vacation.start_date.format("%d.%m.%Y").to_string(),
            vacation.end_date.format("%d.%m.%Y").to_string(),
        );
    }

    Ok(Json(VacationResponse::from(vacation)))
}

/// PUT /employees/:employee_id/vacations/:id/reject
pub async fn reject_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((employee_id, vacation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<VacationResponse>, AppError> {
    require_manager(&auth)?;

    let (vacation, emp_email, emp_name, status_changed) = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let vacation = Vacation::find()
                .filter(Column::Id.eq(vacation_id))
                .filter(Column::TenantId.eq(auth.tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Vacation not found".to_string()))?;

            let previous_status = vacation.status.clone();
            let status_changed = previous_status != "rejected";

            let mut active: ActiveModel = vacation.into();
            active.status = Set("rejected".to_string());
            active.updated_at = Set(chrono::Utc::now().into());
            let updated_vacation = active.update(txn).await?;

            let mut emp_email = String::new();
            let mut emp_name = String::new();

            if let Some(emp) = employee::Entity::find()
                .filter(employee::Column::Id.eq(employee_id))
                .filter(employee::Column::TenantId.eq(auth.tenant_id))
                .one(txn)
                .await?
            {
                emp_email = emp.email.clone().unwrap_or_default();
                let first = emp.first_name.clone().unwrap_or_default();
                let last = emp.last_name.clone().unwrap_or_default();
                emp_name = format!("{} {}", first, last).trim().to_string();

                // If it was previously approved, refund the vacation days back to the employee balance
                if previous_status == "approved" {
                    let closed_list = closed_day::Entity::find()
                        .filter(closed_day::Column::TenantId.eq(auth.tenant_id))
                        .filter(closed_day::Column::ClosedDate.gte(updated_vacation.start_date))
                        .filter(closed_day::Column::ClosedDate.lte(updated_vacation.end_date))
                        .all(txn)
                        .await?;
                    let closed_dates: HashSet<NaiveDate> =
                        closed_list.into_iter().map(|c| c.closed_date).collect();

                    let days = count_vacation_days(
                        updated_vacation.start_date,
                        updated_vacation.end_date,
                        &closed_dates,
                    );
                    let mut active_emp: employee::ActiveModel = emp.into();
                    let new_remaining = active_emp.vacation_days_remaining.unwrap() + days;
                    active_emp.vacation_days_remaining = Set(new_remaining);
                    active_emp.updated_at = Set(chrono::Utc::now().into());
                    active_emp.update(txn).await?;
                }
            }

            Ok((updated_vacation, emp_email, emp_name, status_changed))
        })
    })
    .await?;

    if status_changed && !emp_email.trim().is_empty() {
        crate::services::email_service::notify_vacation_decided(
            state.config.clone(),
            emp_email,
            emp_name,
            "rejected".to_string(),
            vacation.start_date.format("%d.%m.%Y").to_string(),
            vacation.end_date.format("%d.%m.%Y").to_string(),
        );
    }

    Ok(Json(VacationResponse::from(vacation)))
}

/// DELETE /employees/:employee_id/vacations/:id – cancel/delete a vacation request.
/// Employees (`viewer`) may cancel their own `"requested"` vacations; managers may delete any vacation
/// (refunding days if it was `"approved"`).
pub async fn delete_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((employee_id, vacation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let is_manager = matches!(auth.role.as_str(), "super_admin" | "admin" | "planner");
    let tenant_id = auth.tenant_id;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        let auth_clone = auth.clone();
        Box::pin(async move {
            let emp = verify_employee_access(txn, &auth_clone, employee_id).await?;

            let vacation = Vacation::find()
                .filter(Column::Id.eq(vacation_id))
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Urlaubsantrag nicht gefunden.".to_string()))?;

            if !is_manager && vacation.status != "requested" {
                return Err(AppError::BadRequest(
                    "Bereits bearbeitete Urlaubsanträge können nur durch die Planungsleitung storniert werden.".to_string(),
                ));
            }

            if vacation.status == "approved" {
                let closed_list = closed_day::Entity::find()
                    .filter(closed_day::Column::TenantId.eq(tenant_id))
                    .filter(closed_day::Column::ClosedDate.gte(vacation.start_date))
                    .filter(closed_day::Column::ClosedDate.lte(vacation.end_date))
                    .all(txn)
                    .await?;
                let closed_dates: HashSet<NaiveDate> =
                    closed_list.into_iter().map(|c| c.closed_date).collect();

                let days = count_vacation_days(
                    vacation.start_date,
                    vacation.end_date,
                    &closed_dates,
                );
                let mut active_emp: employee::ActiveModel = emp.into();
                let new_remaining = active_emp.vacation_days_remaining.unwrap() + days;
                active_emp.vacation_days_remaining = Set(new_remaining);
                active_emp.updated_at = Set(chrono::Utc::now().into());
                active_emp.update(txn).await?;
            }

            Vacation::delete_many()
                .filter(Column::Id.eq(vacation_id))
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .exec(txn)
                .await?;

            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "deleted": true, "id": vacation_id })))
}

#[derive(Debug, Serialize)]
pub struct TenantVacationResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub employee_id: Uuid,
    pub employee_name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

/// GET /api/vacations – List all vacations for the current tenant. Requires manager.
pub async fn list_tenant_vacations(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<TenantVacationResponse>>, AppError> {
    require_manager(&auth)?;

    let (vacations, employees) = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let vacs = Vacation::find()
                .filter(Column::TenantId.eq(auth.tenant_id))
                .order_by_desc(Column::StartDate)
                .all(txn)
                .await?;
            let emps = employee::Entity::find()
                .filter(employee::Column::TenantId.eq(auth.tenant_id))
                .all(txn)
                .await?;
            Ok((vacs, emps))
        })
    })
    .await?;

    let employee_map: HashMap<Uuid, employee::Model> = employees.into_iter().map(|e| (e.id, e)).collect();

    let response: Vec<TenantVacationResponse> = vacations
        .into_iter()
        .map(|v| {
            let emp_name = if let Some(emp) = employee_map.get(&v.employee_id) {
                let first = emp.first_name.as_deref().unwrap_or("");
                let last = emp.last_name.as_deref().unwrap_or("");
                format!("{} {}", first, last).trim().to_string()
            } else {
                "Unbekannt".to_string()
            };
            TenantVacationResponse {
                id: v.id,
                tenant_id: v.tenant_id,
                employee_id: v.employee_id,
                employee_name: emp_name,
                start_date: v.start_date,
                end_date: v.end_date,
                status: v.status,
                notes: v.notes,
                created_at: v.created_at,
                updated_at: v.updated_at,
            }
        })
        .collect();

    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_vacation_days_excludes_weekends_and_holidays() {
        let start = NaiveDate::from_ymd_opt(2026, 4, 2).unwrap(); // Thursday
        let end = NaiveDate::from_ymd_opt(2026, 4, 7).unwrap();   // Tuesday
        let mut closed = HashSet::new();
        closed.insert(NaiveDate::from_ymd_opt(2026, 4, 3).unwrap()); // Karfreitag
        closed.insert(NaiveDate::from_ymd_opt(2026, 4, 6).unwrap()); // Ostermontag

        // Weekdays in range: Thu Apr 2, Fri Apr 3 (holiday), Mon Apr 6 (holiday), Tue Apr 7 -> 2 days
        assert_eq!(count_vacation_days(start, end, &closed), 2.0);
    }
}
