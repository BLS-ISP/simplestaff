//! Assignment service — business logic for creating and managing shift assignments.
//!
//! The main entry point, [`create_assignment_with_validation`], orchestrates:
//! 1. Loading tenant settings
//! 2. Running validation (produces warnings, never blocks)
//! 3. Persisting the new assignment
//! 4. Returning the assignment together with any warnings

use chrono::{Datelike, Duration, NaiveDate};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::errors::{AppError, ValidationWarning};
use crate::models::{employee, shift_assignment, shift_type, tenant};
use crate::services::validation_service;

// ---------------------------------------------------------------------------
// Assignment creation with validation
// ---------------------------------------------------------------------------

/// Create a shift assignment and return it together with any validation
/// warnings.
///
/// The assignment is **always** persisted – warnings are informational only.
pub async fn create_assignment_with_validation(
    txn: &sea_orm::DatabaseTransaction,
    employee_id: Uuid,
    shift_type_id: Uuid,
    assignment_date: NaiveDate,
    notes: Option<String>,
    tenant_id: Uuid,
) -> Result<(shift_assignment::Model, Vec<ValidationWarning>), AppError> {
    // 1. Load tenant settings from the tenants table.
    let tenant_model = tenant::Entity::find()
        .filter(tenant::Column::Id.eq(tenant_id))
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Tenant {tenant_id} not found")))?;

    let settings = tenant_model.settings;

    // 2. Run validation (warnings only).
    let warnings = validation_service::validate_assignment(
        txn,
        &tenant_id,
        &employee_id,
        &shift_type_id,
        &assignment_date,
        &settings,
    )
    .await?;

    // 3. Create the assignment regardless of warnings.
    let now = chrono::Utc::now().into();
    let new_assignment = shift_assignment::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(tenant_id),
        employee_id: Set(employee_id),
        shift_type_id: Set(shift_type_id),
        assignment_date: Set(assignment_date),
        actual_start: Set(None),
        actual_end: Set(None),
        actual_break_minutes: Set(None),
        status: Set("planned".to_string()),
        notes: Set(notes),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let created = new_assignment.insert(txn).await?;

    // 4. Return assignment + warnings.
    Ok((created, warnings))
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/// Fetch all shift assignments for the ISO week containing `date`, joined with
/// their shift type and employee records.
pub async fn get_weekly_assignments(
    txn: &sea_orm::DatabaseTransaction,
    date: NaiveDate,
    tenant_id: Uuid,
) -> Result<Vec<(shift_assignment::Model, shift_type::Model, employee::Model)>, AppError> {
    let monday = date - Duration::days(date.weekday().num_days_from_monday() as i64);
    let sunday = monday + Duration::days(6);

    fetch_assignments_in_range(txn, monday, sunday, tenant_id).await
}

/// Fetch all shift assignments for a given calendar month, joined with their
/// shift type and employee records.
pub async fn get_monthly_assignments(
    txn: &sea_orm::DatabaseTransaction,
    year: i32,
    month: u32,
    tenant_id: Uuid,
) -> Result<Vec<(shift_assignment::Model, shift_type::Model, employee::Model)>, AppError> {
    let first_day = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::BadRequest(format!("Invalid year/month: {year}/{month}")))?;

    // Last day of the month: go to the first of next month and subtract 1 day.
    let last_day = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or_else(|| AppError::BadRequest(format!("Invalid year/month: {year}/{month}")))?
        - Duration::days(1);

    fetch_assignments_in_range(txn, first_day, last_day, tenant_id).await
}

/// Internal helper: load assignments in a date range and resolve their
/// related shift type and employee models via individual lookups.
async fn fetch_assignments_in_range(
    txn: &sea_orm::DatabaseTransaction,
    start: NaiveDate,
    end: NaiveDate,
    tenant_id: Uuid,
) -> Result<Vec<(shift_assignment::Model, shift_type::Model, employee::Model)>, AppError> {
    let assignments = shift_assignment::Entity::find()
        .filter(shift_assignment::Column::TenantId.eq(tenant_id))
        .filter(shift_assignment::Column::AssignmentDate.gte(start))
        .filter(shift_assignment::Column::AssignmentDate.lte(end))
        .filter(shift_assignment::Column::Status.ne("cancelled"))
        .all(txn)
        .await?;

    let mut results: Vec<(shift_assignment::Model, shift_type::Model, employee::Model)> =
        Vec::with_capacity(assignments.len());

    for assignment in assignments {
        let st = shift_type::Entity::find()
            .filter(shift_type::Column::Id.eq(assignment.shift_type_id))
            .filter(shift_type::Column::TenantId.eq(tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| {
                AppError::InternalError(format!(
                    "Shift type {} referenced by assignment {} not found",
                    assignment.shift_type_id, assignment.id
                ))
            })?;

        let emp = employee::Entity::find()
            .filter(employee::Column::Id.eq(assignment.employee_id))
            .filter(employee::Column::TenantId.eq(tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| {
                AppError::InternalError(format!(
                    "Employee {} referenced by assignment {} not found",
                    assignment.employee_id, assignment.id
                ))
            })?;

        results.push((assignment, st, emp));
    }

    Ok(results)
}
