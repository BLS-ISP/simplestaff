use chrono::{Datelike, NaiveDate, NaiveTime, Duration};
use sea_orm::{DatabaseTransaction, EntityTrait, QueryFilter, ColumnTrait, Condition, PaginatorTrait};
use uuid::Uuid;

use crate::errors::{AppError, ValidationWarning, WarningSeverity};
use crate::models::{employee, employee_blocked_day, employee_vacation, shift_assignment, shift_type};

/// Validates a proposed shift assignment against business rules.
///
/// Returns a list of warnings (possibly empty). Callers decide whether to proceed
/// based on the severity of the warnings.
pub async fn validate_assignment(
    txn: &DatabaseTransaction,
    tenant_id: &Uuid,
    employee_id: &Uuid,
    shift_type_id: &Uuid,
    assignment_date: &NaiveDate,
    tenant_settings: &serde_json::Value,
) -> Result<Vec<ValidationWarning>, AppError> {
    let mut warnings: Vec<ValidationWarning> = Vec::new();

    // Load the shift type we're about to assign
    let shift_type = shift_type::Entity::find()
        .filter(shift_type::Column::Id.eq(*shift_type_id))
        .filter(shift_type::Column::TenantId.eq(*tenant_id))
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

    // ── 1. Blocked day check ──────────────────────────────────────────────
    let blocked = employee_blocked_day::Entity::find()
        .filter(
            Condition::all()
                .add(employee_blocked_day::Column::TenantId.eq(*tenant_id))
                .add(employee_blocked_day::Column::EmployeeId.eq(*employee_id))
                .add(employee_blocked_day::Column::BlockedDate.eq(*assignment_date)),
        )
        .one(txn)
        .await?;

    if blocked.is_some() {
        warnings.push(ValidationWarning {
            code: "BLOCKED_DAY".to_string(),
            message_de: format!(
                "Mitarbeiter hat am {} einen gesperrten Tag.",
                assignment_date.format("%d.%m.%Y")
            ),
            message_en: format!(
                "Employee has a blocked day on {}.",
                assignment_date.format("%Y-%m-%d")
            ),
            severity: WarningSeverity::Critical,
        });
    }

    // ── 2. Vacation check ─────────────────────────────────────────────────
    let vacation = employee_vacation::Entity::find()
        .filter(
            Condition::all()
                .add(employee_vacation::Column::TenantId.eq(*tenant_id))
                .add(employee_vacation::Column::EmployeeId.eq(*employee_id))
                .add(employee_vacation::Column::StartDate.lte(*assignment_date))
                .add(employee_vacation::Column::EndDate.gte(*assignment_date))
                .add(employee_vacation::Column::Status.eq("approved")),
        )
        .one(txn)
        .await?;

    if vacation.is_some() {
        warnings.push(ValidationWarning {
            code: "ON_VACATION".to_string(),
            message_de: format!(
                "Mitarbeiter ist am {} im genehmigten Urlaub.",
                assignment_date.format("%d.%m.%Y")
            ),
            message_en: format!(
                "Employee is on approved vacation on {}.",
                assignment_date.format("%Y-%m-%d")
            ),
            severity: WarningSeverity::Critical,
        });
    }

    // ── 2.b Weekday availability (Sperrzeit) check ───────────────────────
    let day_of_week = assignment_date.weekday().number_from_monday();
    let emp = employee::Entity::find()
        .filter(employee::Column::Id.eq(*employee_id))
        .filter(employee::Column::TenantId.eq(*tenant_id))
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Employee not found".to_string()))?;

    let protection_profile = employee::get_protection_profile(&emp);
    let pref = employee::get_shift_pref(&emp, shift_type_id, day_of_week);

    if pref == 1 {
        let weekday_name_de = match day_of_week {
            1 => "Montag",
            2 => "Dienstag",
            3 => "Mittwoch",
            4 => "Donnerstag",
            5 => "Freitag",
            6 => "Samstag",
            _ => "Sonntag",
        };
        let weekday_name_en = match day_of_week {
            1 => "Monday",
            2 => "Tuesday",
            3 => "Wednesday",
            4 => "Thursday",
            5 => "Friday",
            6 => "Saturday",
            _ => "Sunday",
        };

        warnings.push(ValidationWarning {
            code: "UNAVAILABLE_SLOT".to_string(),
            message_de: format!(
                "Mitarbeiter hat am Wochentag ({}) eine Sperrzeit für den Schichttyp ({}) hinterlegt.",
                weekday_name_de,
                shift_type.name
            ),
            message_en: format!(
                "Employee has marked a blocked slot for shift type ({}) on {}s.",
                shift_type.name,
                weekday_name_en
            ),
            severity: WarningSeverity::Warning,
        });
    }

    // ── 3. Rest period violation (previous day & next day) ────────────────
    let tenant_min_rest_hours = tenant_settings
        .get("min_rest_hours")
        .and_then(|v| v.as_f64())
        .unwrap_or(11.0);
    let min_rest_hours = effective_min_rest_hours(tenant_min_rest_hours, protection_profile);

    let previous_day = *assignment_date - Duration::days(1);
    let next_day = *assignment_date + Duration::days(1);

    let prev_day_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.eq(previous_day))
                .add(shift_assignment::Column::Status.ne("sick")),
        )
        .all(txn)
        .await?;

    let new_start = shift_type.start_time;
    let new_end = shift_type.end_time;
    let new_is_overnight = new_end < new_start;

    for prev_assignment in &prev_day_assignments {
        let prev_shift = shift_type::Entity::find()
            .filter(shift_type::Column::Id.eq(prev_assignment.shift_type_id))
            .filter(shift_type::Column::TenantId.eq(*tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Previous shift type not found".to_string()))?;

        let prev_end = prev_shift.end_time;
        let prev_is_overnight = prev_shift.end_time < prev_shift.start_time;

        // Calculate hours between prev shift end and new shift start.
        let rest_minutes = if prev_is_overnight {
            let diff = time_diff_minutes(prev_end, new_start);
            if diff > 0 { diff } else { 0 }
        } else {
            let minutes_until_midnight = minutes_from_time_to_midnight(prev_end);
            let minutes_from_midnight = minutes_from_midnight_to_time(new_start);
            minutes_until_midnight + minutes_from_midnight
        };

        let rest_hours = rest_minutes as f64 / 60.0;

        if rest_hours < min_rest_hours {
            warnings.push(ValidationWarning {
                code: "REST_PERIOD_VIOLATION".to_string(),
                message_de: format!(
                    "Ruhezeit von {:.1}h unterschreitet die Mindestruhezeit von {:.0}h (Vortagesschicht endet um {}).",
                    rest_hours,
                    min_rest_hours,
                    prev_end.format("%H:%M")
                ),
                message_en: format!(
                    "Rest period of {:.1}h is less than the minimum {:.0}h (previous day shift ends at {}).",
                    rest_hours,
                    min_rest_hours,
                    prev_end.format("%H:%M")
                ),
                severity: WarningSeverity::Warning,
            });
        }
    }

    let next_day_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.eq(next_day))
                .add(shift_assignment::Column::Status.ne("sick")),
        )
        .all(txn)
        .await?;

    for next_assignment in &next_day_assignments {
        let next_shift = shift_type::Entity::find()
            .filter(shift_type::Column::Id.eq(next_assignment.shift_type_id))
            .filter(shift_type::Column::TenantId.eq(*tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Next shift type not found".to_string()))?;

        let next_start = next_shift.start_time;

        let rest_minutes = if new_is_overnight {
            let diff = time_diff_minutes(new_end, next_start);
            if diff > 0 { diff } else { 0 }
        } else {
            let minutes_until_midnight = minutes_from_time_to_midnight(new_end);
            let minutes_from_midnight = minutes_from_midnight_to_time(next_start);
            minutes_until_midnight + minutes_from_midnight
        };

        let rest_hours = rest_minutes as f64 / 60.0;

        if rest_hours < min_rest_hours {
            warnings.push(ValidationWarning {
                code: "REST_PERIOD_VIOLATION".to_string(),
                message_de: format!(
                    "Ruhezeit von {:.1}h zum Folgetag unterschreitet die Mindestruhezeit von {:.0}h (Folgeschicht beginnt um {}).",
                    rest_hours,
                    min_rest_hours,
                    next_start.format("%H:%M")
                ),
                message_en: format!(
                    "Rest period of {:.1}h before next day shift is less than the minimum {:.0}h (next day shift starts at {}).",
                    rest_hours,
                    min_rest_hours,
                    next_start.format("%H:%M")
                ),
                severity: WarningSeverity::Warning,
            });
        }
    }

    // ── 4. Max daily hours exceeded & same-day shift overlap ──────────────
    let tenant_max_daily_hours = tenant_settings
        .get("max_daily_hours")
        .and_then(|v| v.as_f64())
        .unwrap_or(10.0);
    let max_daily_hours = effective_max_daily_hours(tenant_max_daily_hours, protection_profile);

    let same_day_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.eq(*assignment_date))
                .add(shift_assignment::Column::Status.ne("sick")),
        )
        .all(txn)
        .await?;

    let mut total_daily_hours: f64 = 0.0;

    for assignment in &same_day_assignments {
        let st = shift_type::Entity::find()
            .filter(shift_type::Column::Id.eq(assignment.shift_type_id))
            .filter(shift_type::Column::TenantId.eq(*tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

        total_daily_hours += calculate_shift_duration_for_employee(&st, tenant_settings, protection_profile);
    }

    // Add the proposed shift's duration
    let new_shift_duration = calculate_shift_duration_for_employee(&shift_type, tenant_settings, protection_profile);
    total_daily_hours += new_shift_duration;

    if total_daily_hours > max_daily_hours {
        warnings.push(ValidationWarning {
            code: "MAX_DAILY_HOURS".to_string(),
            message_de: format!(
                "Tägliche Arbeitszeit von {:.1}h überschreitet das Maximum von {:.1}h.",
                total_daily_hours, max_daily_hours
            ),
            message_en: format!(
                "Daily working hours of {:.1}h exceed the maximum of {:.1}h.",
                total_daily_hours, max_daily_hours
            ),
            severity: WarningSeverity::Warning,
        });
    }

    // ── 5. Weekly hours exceeded ──────────────────────────────────────────
    let emp_weekly_hours = emp.weekly_hours as f64;
    let tenant_max_weekly_hours = tenant_settings
        .get("max_weekly_hours")
        .and_then(|v| v.as_f64());
    let weekly_hours_limit = effective_max_weekly_hours(
        emp_weekly_hours,
        tenant_max_weekly_hours,
        protection_profile,
    );

    // Calculate Monday–Sunday of the assignment week
    let weekday = assignment_date.weekday().num_days_from_monday(); // Mon=0 .. Sun=6
    let week_start = *assignment_date - Duration::days(weekday as i64);
    let week_end = week_start + Duration::days(6);

    let weekly_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.gte(week_start))
                .add(shift_assignment::Column::AssignmentDate.lte(week_end))
                .add(shift_assignment::Column::Status.ne("sick")),
        )
        .all(txn)
        .await?;

    let mut total_weekly_hours: f64 = 0.0;

    for assignment in &weekly_assignments {
        let st = shift_type::Entity::find()
            .filter(shift_type::Column::Id.eq(assignment.shift_type_id))
            .filter(shift_type::Column::TenantId.eq(*tenant_id))
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

        total_weekly_hours += calculate_shift_duration_for_employee(&st, tenant_settings, protection_profile);
    }

    // Add the proposed shift
    total_weekly_hours += new_shift_duration;

    if total_weekly_hours > weekly_hours_limit {
        warnings.push(ValidationWarning {
            code: "WEEKLY_HOURS_EXCEEDED".to_string(),
            message_de: format!(
                "Wöchentliche Arbeitszeit von {:.1}h überschreitet das Limit von {:.0}h.",
                total_weekly_hours, weekly_hours_limit
            ),
            message_en: format!(
                "Weekly working hours of {:.1}h exceed the limit of {:.0}h.",
                total_weekly_hours, weekly_hours_limit
            ),
            severity: WarningSeverity::Warning,
        });
    }

    // ── 5b. Monthly hours exceeded (Minijob / Vertragskontingent) ─────────
    if let Some(monthly_max) = emp.monthly_hours.filter(|&m| m > 0.0) {
        let (month_start, month_end) = month_bounds(*assignment_date);
        let monthly_assignments = shift_assignment::Entity::find()
            .filter(
                Condition::all()
                    .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                    .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                    .add(shift_assignment::Column::AssignmentDate.gte(month_start))
                    .add(shift_assignment::Column::AssignmentDate.lte(month_end))
                    .add(shift_assignment::Column::Status.ne("sick")),
            )
            .all(txn)
            .await?;

        let mut total_monthly_hours: f64 = 0.0;
        for assignment in &monthly_assignments {
            let st = shift_type::Entity::find()
                .filter(shift_type::Column::Id.eq(assignment.shift_type_id))
                .filter(shift_type::Column::TenantId.eq(*tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

            total_monthly_hours += calculate_shift_duration_for_employee(&st, tenant_settings, protection_profile);
        }

        total_monthly_hours += new_shift_duration;

        if total_monthly_hours > monthly_max as f64 {
            warnings.push(ValidationWarning {
                code: "MONTHLY_HOURS_EXCEEDED".to_string(),
                message_de: format!(
                    "Monatliche Arbeitszeit von {:.1}h überschreitet das Monatskontingent / Minijob-Limit von {:.1}h.",
                    total_monthly_hours, monthly_max
                ),
                message_en: format!(
                    "Monthly working hours of {:.1}h exceed the monthly / mini-job limit of {:.1}h.",
                    total_monthly_hours, monthly_max
                ),
                severity: WarningSeverity::Warning,
            });
        }
    }

    // ── 6. Weekday validity check ─────────────────────────────────────────
    let valid_days: Vec<u32> = serde_json::from_value(shift_type.valid_days.clone())
        .unwrap_or_else(|_| vec![1, 2, 3, 4, 5, 6, 7]);

    // ── 6a. Holiday validity check ────────────────────────────────────────
    let is_holiday = crate::models::closed_day::Entity::find()
        .filter(crate::models::closed_day::Column::TenantId.eq(*tenant_id))
        .filter(crate::models::closed_day::Column::ClosedDate.eq(*assignment_date))
        .filter(crate::models::closed_day::Column::IsHoliday.eq(true))
        .one(txn)
        .await?
        .is_some();

    if is_holiday {
        if shift_type.holiday_mode == "no_holidays" {
            warnings.push(ValidationWarning {
                code: "SHIFT_NOT_ALLOWED_ON_HOLIDAY".to_string(),
                message_de: format!(
                    "Die Schicht '{}' ist an Feiertagen ({}) nicht zulässig.",
                    shift_type.name,
                    assignment_date.format("%d.%m.%Y")
                ),
                message_en: format!(
                    "The shift '{}' is not allowed on public holidays ({}).",
                    shift_type.name,
                    assignment_date.format("%Y-%m-%d")
                ),
                severity: WarningSeverity::Warning,
            });
        }
    } else {
        if shift_type.holiday_mode == "only_holidays" {
            warnings.push(ValidationWarning {
                code: "SHIFT_ONLY_ALLOWED_ON_HOLIDAY".to_string(),
                message_de: format!(
                    "Die Schicht '{}' ist nur an Feiertagen zulässig.",
                    shift_type.name
                ),
                message_en: format!(
                    "The shift '{}' is only allowed on public holidays.",
                    shift_type.name
                ),
                severity: WarningSeverity::Warning,
            });
        }
    }

    let weekday = assignment_date.weekday().number_from_monday();

    if !valid_days.contains(&weekday) {
        let (day_de, day_en) = match weekday {
            1 => ("Montag", "Monday"),
            2 => ("Dienstag", "Tuesday"),
            3 => ("Mittwoch", "Wednesday"),
            4 => ("Donnerstag", "Thursday"),
            5 => ("Freitag", "Friday"),
            6 => ("Samstag", "Saturday"),
            7 => ("Sonntag", "Sunday"),
            _ => ("Ungültiger Tag", "Invalid Day"),
        };

        warnings.push(ValidationWarning {
            code: "INVALID_WEEKDAY".to_string(),
            message_de: format!(
                "Dieser Schichttyp ist am Wochentag {} ({}) nicht gültig.",
                day_de,
                assignment_date.format("%d.%m.%Y")
            ),
            message_en: format!(
                "This shift type is not valid on {} ({}).",
                day_en,
                assignment_date.format("%Y-%m-%d")
            ),
            severity: WarningSeverity::Warning,
        });
    }

    // ── 7. Staffing limits check (min/max staff) ─────────────────────────
    if shift_type.min_staff.is_some() || shift_type.max_staff.is_some() {
        let current_staff_count = shift_assignment::Entity::find()
            .filter(
                Condition::all()
                    .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                    .add(shift_assignment::Column::ShiftTypeId.eq(*shift_type_id))
                    .add(shift_assignment::Column::AssignmentDate.eq(*assignment_date))
                    .add(shift_assignment::Column::Status.ne("sick"))
            )
            .count(txn)
            .await?;

        let already_assigned = shift_assignment::Entity::find()
            .filter(
                Condition::all()
                    .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                    .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                    .add(shift_assignment::Column::ShiftTypeId.eq(*shift_type_id))
                    .add(shift_assignment::Column::AssignmentDate.eq(*assignment_date))
                    .add(shift_assignment::Column::Status.ne("sick"))
            )
            .one(txn)
            .await?
            .is_some();

        let proposed_count = if already_assigned { current_staff_count } else { current_staff_count + 1 };

        if let Some(max) = shift_type.max_staff {
            if proposed_count > max as u64 {
                warnings.push(ValidationWarning {
                    code: "MAX_STAFF_EXCEEDED".to_string(),
                    message_de: format!(
                        "Die Schicht '{}' am {} überschreitet die Maximalbesetzung von {} Mitarbeitern (aktuell eingeteilt: {}).",
                        shift_type.name,
                        assignment_date.format("%d.%m.%Y"),
                        max,
                        proposed_count
                    ),
                    message_en: format!(
                        "The shift '{}' on {} exceeds the maximum staffing limit of {} (currently scheduled: {}).",
                        shift_type.name,
                        assignment_date.format("%Y-%m-%d"),
                        max,
                        proposed_count
                    ),
                    severity: WarningSeverity::Warning,
                });
            }
        }

        if let Some(min) = shift_type.min_staff {
            if proposed_count < min as u64 {
                warnings.push(ValidationWarning {
                    code: "MIN_STAFF_NOT_REACHED".to_string(),
                    message_de: format!(
                        "Die Schicht '{}' am {} unterschreitet die Mindestbesetzung von {} Mitarbeitern (aktuell eingeteilt: {}).",
                        shift_type.name,
                        assignment_date.format("%d.%m.%Y"),
                        min,
                        proposed_count
                    ),
                    message_en: format!(
                        "The shift '{}' on {} is understaffed. Minimum required: {}, currently scheduled: {}.",
                        shift_type.name,
                        assignment_date.format("%Y-%m-%d"),
                        min,
                        proposed_count
                    ),
                    severity: WarningSeverity::Warning,
                });
            }
        }
    }

    // ── 8. Closed days / Public holidays check ────────────────────────────
    let closed_day = crate::models::closed_day::Entity::find()
        .filter(crate::models::closed_day::Column::TenantId.eq(*tenant_id))
        .filter(crate::models::closed_day::Column::ClosedDate.eq(*assignment_date))
        .one(txn)
        .await?;

    if let Some(cd) = closed_day {
        if cd.is_holiday {
            warnings.push(ValidationWarning {
                code: "PUBLIC_HOLIDAY".to_string(),
                message_de: format!(
                    "Der {} ist ein gesetzlicher Feiertag ({}).",
                    assignment_date.format("%d.%m.%Y"),
                    cd.description
                ),
                message_en: format!(
                    "{} is a public holiday ({}).",
                    assignment_date.format("%Y-%m-%d"),
                    cd.description
                ),
                severity: WarningSeverity::Warning,
            });
        } else {
            warnings.push(ValidationWarning {
                code: "COMPANY_CLOSED".to_string(),
                message_de: format!(
                    "Der Betrieb ist am {} geschlossen ({}).",
                    assignment_date.format("%d.%m.%Y"),
                    cd.description
                ),
                message_en: format!(
                    "The business is closed on {} ({}).",
                    assignment_date.format("%Y-%m-%d"),
                    cd.description
                ),
                severity: WarningSeverity::Warning,
            });
        }
    }

    // ── 9. Max consecutive working days (§ 11 Abs. 3 ArbZG / § 15 JArbSchG) ──
    let tenant_max_consec = tenant_settings
        .get("max_consecutive_days")
        .and_then(|v| v.as_u64())
        .unwrap_or(6) as u32;
    let max_consecutive_days = effective_max_consecutive_days(tenant_max_consec, protection_profile);

    let streak_window_start = *assignment_date - Duration::days(14);
    let streak_window_end = *assignment_date + Duration::days(14);

    let window_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::TenantId.eq(*tenant_id))
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.gte(streak_window_start))
                .add(shift_assignment::Column::AssignmentDate.lte(streak_window_end))
                .add(shift_assignment::Column::Status.ne("sick")),
        )
        .all(txn)
        .await?;

    let worked_dates: std::collections::HashSet<NaiveDate> = window_assignments
        .iter()
        .map(|a| a.assignment_date)
        .collect();

    let mut before_streak: u32 = 0;
    let mut check_d = *assignment_date - Duration::days(1);
    while worked_dates.contains(&check_d) {
        before_streak += 1;
        check_d -= Duration::days(1);
    }

    let mut after_streak: u32 = 0;
    let mut check_d_after = *assignment_date + Duration::days(1);
    while worked_dates.contains(&check_d_after) {
        after_streak += 1;
        check_d_after += Duration::days(1);
    }

    let total_consecutive_days = before_streak + 1 + after_streak;
    if total_consecutive_days > max_consecutive_days {
        warnings.push(ValidationWarning {
            code: "MAX_CONSECUTIVE_DAYS_EXCEEDED".to_string(),
            message_de: format!(
                "{} Arbeitstage am Stück überschreiten das zulässige Maximum von {} Tagen ohne Ruhetag.",
                total_consecutive_days, max_consecutive_days
            ),
            message_en: format!(
                "{} consecutive working days exceed the maximum of {} days without a rest day.",
                total_consecutive_days, max_consecutive_days
            ),
            severity: WarningSeverity::Warning,
        });
    }

    // ── 10. Max consecutive night shifts (§ 6 Abs. 1 ArbZG) ───────────────
    if is_night_shift(shift_type.start_time, shift_type.end_time) {
        let max_consecutive_nights = tenant_settings
            .get("max_consecutive_night_shifts")
            .and_then(|v| v.as_u64())
            .unwrap_or(4) as u32;

        // Determine which dates in window_assignments have a night shift
        let all_tenant_shifts = shift_type::Entity::find()
            .filter(shift_type::Column::TenantId.eq(*tenant_id))
            .all(txn)
            .await?;
        let night_shift_ids: std::collections::HashSet<Uuid> = all_tenant_shifts
            .into_iter()
            .filter(|st| is_night_shift(st.start_time, st.end_time))
            .map(|st| st.id)
            .collect();

        let night_dates: std::collections::HashSet<NaiveDate> = window_assignments
            .iter()
            .filter(|a| night_shift_ids.contains(&a.shift_type_id))
            .map(|a| a.assignment_date)
            .collect();

        let mut night_before = 0u32;
        let mut d_prev = *assignment_date - Duration::days(1);
        while night_dates.contains(&d_prev) {
            night_before += 1;
            d_prev -= Duration::days(1);
        }

        let mut night_after = 0u32;
        let mut d_next = *assignment_date + Duration::days(1);
        while night_dates.contains(&d_next) {
            night_after += 1;
            d_next += Duration::days(1);
        }

        let total_night_streak = night_before + 1 + night_after;
        if total_night_streak > max_consecutive_nights {
            warnings.push(ValidationWarning {
                code: "MAX_CONSECUTIVE_NIGHT_SHIFTS".to_string(),
                message_de: format!(
                    "{} Nachtschichten in Folge überschreiten das Limit von {} Nachtschichten (§ 6 ArbZG).",
                    total_night_streak, max_consecutive_nights
                ),
                message_en: format!(
                    "{} consecutive night shifts exceed the limit of {} night shifts (§ 6 ArbZG).",
                    total_night_streak, max_consecutive_nights
                ),
                severity: WarningSeverity::Warning,
            });
        }
    }

    // ── 11. Youth (JArbSchG) & Maternity (MuSchG) statutory protections ───
    if let Some((allowed_window, law_ref)) =
        violates_protected_time_window(shift_type.start_time, shift_type.end_time, protection_profile)
    {
        warnings.push(ValidationWarning {
            code: "PROTECTED_NIGHT_WORK_PROHIBITION".to_string(),
            message_de: format!(
                "Beschäftigungsverbot ({}): Schicht ({}–{}) liegt außerhalb des zulässigen Zeitfensters ({} Uhr).",
                law_ref,
                shift_type.start_time.format("%H:%M"),
                shift_type.end_time.format("%H:%M"),
                allowed_window
            ),
            message_en: format!(
                "Night work prohibition ({}): Shift ({}–{}) is outside the permitted time window ({}).",
                law_ref,
                shift_type.start_time.format("%H:%M"),
                shift_type.end_time.format("%H:%M"),
                allowed_window
            ),
            severity: WarningSeverity::Critical,
        });
    }

    if protection_profile == "youth" && (weekday == 7 || is_holiday) {
        warnings.push(ValidationWarning {
            code: "YOUTH_SUNDAY_HOLIDAY_REST".to_string(),
            message_de: "Sonn- und Feiertagsarbeitsverbot für Jugendliche unter 18 Jahren (§§ 17, 18 JArbSchG).".to_string(),
            message_en: "Sunday and public holiday work prohibition for youths under 18 (§§ 17, 18 JArbSchG).".to_string(),
            severity: WarningSeverity::Critical,
        });
    } else if protection_profile == "youth_hospitality" && weekday == 7 {
        let prev_sunday = *assignment_date - Duration::days(7);
        let next_sunday = *assignment_date + Duration::days(7);
        if worked_dates.contains(&prev_sunday) || worked_dates.contains(&next_sunday) {
            warnings.push(ValidationWarning {
                code: "YOUTH_SUNDAY_HOLIDAY_REST".to_string(),
                message_de: "Verstoß gegen § 17 Abs. 2 JArbSchG: Im Gastgewerbe muss für Jugendliche mindestens jeder zweite Sonntag beschäftigungsfrei bleiben.".to_string(),
                message_en: "Violation of § 17(2) JArbSchG: For youth in hospitality, at least every second Sunday must be free of work.".to_string(),
                severity: WarningSeverity::Critical,
            });
        }
    }

    Ok(warnings)
}

/// Calculates the first and last day of the calendar month for `date`.
pub fn month_bounds(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    let first = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date);
    let next_month_first = if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap_or(date)
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1).unwrap_or(date)
    };
    let last = next_month_first - Duration::days(1);
    (first, last)
}

/// Effective minimum rest period in hours, accounting for JArbSchG (12h) and MuSchG (11h).
pub fn effective_min_rest_hours(tenant_min_rest: f64, protection_profile: &str) -> f64 {
    match protection_profile {
        "youth" | "youth_hospitality" => tenant_min_rest.max(12.0),
        "maternity" => tenant_min_rest.max(11.0),
        _ => tenant_min_rest,
    }
}

/// Effective maximum daily working hours, accounting for JArbSchG (8.0h) and MuSchG (8.5h).
pub fn effective_max_daily_hours(tenant_max_daily: f64, protection_profile: &str) -> f64 {
    match protection_profile {
        "youth" | "youth_hospitality" => tenant_max_daily.min(8.0),
        "maternity" => tenant_max_daily.min(8.5),
        _ => tenant_max_daily,
    }
}

/// Effective maximum weekly working hours, accounting for JArbSchG (40.0h) and MuSchG (40.0h).
pub fn effective_max_weekly_hours(
    emp_weekly: f64,
    tenant_max_weekly: Option<f64>,
    protection_profile: &str,
) -> f64 {
    let base = match tenant_max_weekly {
        Some(t_max) => emp_weekly.min(t_max),
        None => emp_weekly,
    };
    match protection_profile {
        "youth" | "youth_hospitality" | "maternity" => base.min(40.0),
        _ => base,
    }
}

/// Effective maximum consecutive working days, accounting for § 15 JArbSchG (5-Tage-Woche).
pub fn effective_max_consecutive_days(tenant_max_consecutive: u32, protection_profile: &str) -> u32 {
    match protection_profile {
        "youth" | "youth_hospitality" => tenant_max_consecutive.min(5),
        "maternity" => tenant_max_consecutive.min(6),
        _ => tenant_max_consecutive,
    }
}

/// Checks if a shift qualifies as a night shift under § 2 Abs. 3 & 4 ArbZG
/// (either crosses midnight or includes more than 2 hours in the 23:00–06:00 window).
pub fn is_night_shift(start: NaiveTime, end: NaiveTime) -> bool {
    if end < start {
        return true;
    }
    night_minutes_23_to_06(start, end) > 120
}

/// Returns the number of minutes of `[start, end]` falling into the 23:00–06:00 night window.
pub fn night_minutes_23_to_06(start: NaiveTime, end: NaiveTime) -> i64 {
    let s = minutes_from_midnight_to_time(start);
    let e_raw = minutes_from_midnight_to_time(end);
    let e = if e_raw < s { e_raw + 1440 } else { e_raw };

    let windows = [(0i64, 360i64), (1380i64, 1800i64), (2820i64, 2880i64)];
    let mut overlap = 0i64;
    for (w_start, w_end) in windows {
        let lo = s.max(w_start);
        let hi = e.min(w_end);
        if hi > lo {
            overlap += hi - lo;
        }
    }
    overlap
}

/// Checks whether `(start, end)` violates the statutory night work prohibition for
/// youth (§ 14 JArbSchG) or maternity (§ 5 MuSchG) profiles.
/// Returns `Some((allowed_window, law_reference))` when violated.
pub fn violates_protected_time_window(
    start: NaiveTime,
    end: NaiveTime,
    protection_profile: &str,
) -> Option<(&'static str, &'static str)> {
    match protection_profile {
        "youth" => {
            let min_start = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
            let max_end = NaiveTime::from_hms_opt(20, 0, 0).unwrap();
            if end < start || start < min_start || end > max_end {
                Some(("06:00–20:00", "§ 14 Abs. 1 JArbSchG"))
            } else {
                None
            }
        }
        "youth_hospitality" => {
            let min_start = NaiveTime::from_hms_opt(5, 0, 0).unwrap();
            let max_end = NaiveTime::from_hms_opt(22, 0, 0).unwrap();
            if end < start || start < min_start || end > max_end {
                Some(("05:00–22:00", "§ 14 Abs. 2 JArbSchG"))
            } else {
                None
            }
        }
        "maternity" => {
            let min_start = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
            let max_end = NaiveTime::from_hms_opt(20, 0, 0).unwrap();
            if end < start || start < min_start || end > max_end {
                Some(("06:00–20:00", "§ 5 MuSchG"))
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Calculates the effective duration of a shift in hours, accounting for night shifts
/// and automatic break deductions based on tenant settings (falling back to shift.break_minutes).
pub fn calculate_shift_duration(
    shift: &shift_type::Model,
    tenant_settings: &serde_json::Value,
) -> f64 {
    calculate_shift_duration_for_employee(shift, tenant_settings, "standard")
}

/// Calculates the effective duration of a shift in hours for a specific employee protection profile,
/// applying elevated statutory break rules under § 11 JArbSchG (4.5h -> 30m, >6h -> 60m) for youths.
pub fn calculate_shift_duration_for_employee(
    shift: &shift_type::Model,
    tenant_settings: &serde_json::Value,
    protection_profile: &str,
) -> f64 {
    let start = shift.start_time;
    let end = shift.end_time;

    let total_minutes = if end >= start {
        // Normal day shift
        time_diff_minutes(start, end)
    } else {
        // Night shift: crosses midnight
        let minutes_until_midnight = minutes_from_time_to_midnight(start);
        let minutes_from_midnight = minutes_from_midnight_to_time(end);
        minutes_until_midnight + minutes_from_midnight
    };

    let gross_hours = total_minutes as f64 / 60.0;

    // Apply break rules from tenant settings, falling back to shift.break_minutes
    let rule_break_minutes = calculate_break_minutes(gross_hours, tenant_settings);
    let mut break_minutes = if rule_break_minutes > 0 {
        rule_break_minutes
    } else {
        shift.break_minutes.max(0) as i64
    };

    // § 11 JArbSchG: Jugendliche müssen ab 4,5h mind. 30 Min. und ab >6,0h mind. 60 Min. Pause erhalten
    if matches!(protection_profile, "youth" | "youth_hospitality") {
        let youth_break = if gross_hours > 6.0 {
            60
        } else if gross_hours >= 4.5 {
            30
        } else {
            0
        };
        break_minutes = break_minutes.max(youth_break);
    }

    (gross_hours - (break_minutes as f64 / 60.0)).max(0.0)
}

/// Determines the break duration in minutes based on the gross working hours
/// and the tenant's break rules (supports both `from_hours` and `min_hours` keys).
fn calculate_break_minutes(gross_hours: f64, tenant_settings: &serde_json::Value) -> i64 {
    let break_rules = tenant_settings
        .get("break_rules")
        .and_then(|v| v.as_array());

    let mut break_minutes: i64 = 0;

    if let Some(rules) = break_rules {
        for rule in rules {
            let min_hours = rule
                .get("from_hours")
                .or_else(|| rule.get("min_hours"))
                .and_then(|v| v.as_f64());
            let minutes = rule
                .get("break_minutes")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if let Some(threshold) = min_hours {
                if gross_hours >= threshold && minutes > break_minutes {
                    break_minutes = minutes;
                }
            }
        }
    }

    break_minutes
}

/// Returns the number of minutes between two times on the same day.
/// Result may be negative if `to` is before `from`.
fn time_diff_minutes(from: NaiveTime, to: NaiveTime) -> i64 {
    let diff = to.signed_duration_since(from);
    diff.num_minutes()
}

/// Returns minutes from the given time until midnight (00:00 next day).
fn minutes_from_time_to_midnight(time: NaiveTime) -> i64 {
    let midnight = NaiveTime::from_hms_opt(0, 0, 0).unwrap();
    let total_day_minutes: i64 = 24 * 60;
    let minutes_since_midnight = time.signed_duration_since(midnight).num_minutes();
    total_day_minutes - minutes_since_midnight
}

/// Returns minutes from midnight (00:00) to the given time.
fn minutes_from_midnight_to_time(time: NaiveTime) -> i64 {
    let midnight = NaiveTime::from_hms_opt(0, 0, 0).unwrap();
    time.signed_duration_since(midnight).num_minutes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_day_shift_to_early_shift_rest() {
        let prev_start = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        let prev_end = NaiveTime::from_hms_opt(16, 0, 0).unwrap();
        let new_start = NaiveTime::from_hms_opt(7, 0, 0).unwrap();

        let prev_is_overnight = prev_end < prev_start;
        assert!(!prev_is_overnight);

        let minutes_until_midnight = minutes_from_time_to_midnight(prev_end);
        let minutes_from_midnight = minutes_from_midnight_to_time(new_start);
        let rest_hours = (minutes_until_midnight + minutes_from_midnight) as f64 / 60.0;

        assert_eq!(rest_hours, 15.0); // 16:00 yesterday to 07:00 today = 15 hours
    }

    #[test]
    fn test_night_shift_to_morning_shift_rest() {
        let prev_start = NaiveTime::from_hms_opt(22, 0, 0).unwrap();
        let prev_end = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
        let new_start = NaiveTime::from_hms_opt(8, 0, 0).unwrap();

        let prev_is_overnight = prev_end < prev_start;
        assert!(prev_is_overnight);

        let diff = time_diff_minutes(prev_end, new_start);
        let rest_hours = diff as f64 / 60.0;

        assert_eq!(rest_hours, 2.0); // 06:00 today to 08:00 today = 2 hours
    }

    #[test]
    fn test_night_shift_to_evening_shift_rest() {
        let prev_start = NaiveTime::from_hms_opt(22, 0, 0).unwrap();
        let prev_end = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
        let new_start = NaiveTime::from_hms_opt(18, 0, 0).unwrap();

        let prev_is_overnight = prev_end < prev_start;
        assert!(prev_is_overnight);

        let diff = time_diff_minutes(prev_end, new_start);
        let rest_hours = diff as f64 / 60.0;

        assert_eq!(rest_hours, 12.0); // 06:00 today to 18:00 today = 12 hours
    }

    #[test]
    fn test_night_shift_detection_arbzg() {
        let day_start = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        let day_end = NaiveTime::from_hms_opt(16, 30, 0).unwrap();
        assert!(!is_night_shift(day_start, day_end));

        let late_start = NaiveTime::from_hms_opt(14, 0, 0).unwrap();
        let late_end = NaiveTime::from_hms_opt(22, 30, 0).unwrap();
        assert!(!is_night_shift(late_start, late_end));

        // 04:00 to 12:00 includes 2.0h in 00:00-06:00 (not > 2h)
        let early_start = NaiveTime::from_hms_opt(4, 0, 0).unwrap();
        let early_end = NaiveTime::from_hms_opt(12, 0, 0).unwrap();
        assert!(!is_night_shift(early_start, early_end));

        // 03:30 to 11:30 includes 2.5h in 00:00-06:00 (> 2h -> night shift)
        let very_early_start = NaiveTime::from_hms_opt(3, 30, 0).unwrap();
        let very_early_end = NaiveTime::from_hms_opt(11, 30, 0).unwrap();
        assert!(is_night_shift(very_early_start, very_early_end));

        // Overnight shift 22:00 to 06:00
        let night_start = NaiveTime::from_hms_opt(22, 0, 0).unwrap();
        let night_end = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
        assert!(is_night_shift(night_start, night_end));
    }

    #[test]
    fn test_protected_time_windows_jarbschg_and_muschg() {
        let s_06 = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
        let e_14 = NaiveTime::from_hms_opt(14, 0, 0).unwrap();
        let e_21 = NaiveTime::from_hms_opt(21, 0, 0).unwrap();
        let e_23 = NaiveTime::from_hms_opt(23, 0, 0).unwrap();

        assert!(violates_protected_time_window(s_06, e_14, "youth").is_none());
        assert!(violates_protected_time_window(s_06, e_21, "youth").is_some());
        assert!(violates_protected_time_window(s_06, e_21, "youth_hospitality").is_none());
        assert!(violates_protected_time_window(s_06, e_23, "youth_hospitality").is_some());
        assert!(violates_protected_time_window(s_06, e_21, "maternity").is_some());
    }

    #[test]
    fn test_youth_break_rules_jarbschg() {
        let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
        let shift = shift_type::Model {
            id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            name: "Tagesschicht".to_string(),
            start_time: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(15, 0, 0).unwrap(), // 7.0h gross
            break_minutes: 30,
            color: "#3b82f6".to_string(),
            min_staff: Some(1),
            max_staff: Some(3),
            valid_days: serde_json::json!([1, 2, 3, 4, 5]),
            holiday_mode: "all".to_string(),
            is_active: true,
            created_at: now,
            updated_at: now,
        };
        let settings = serde_json::json!({
            "break_rules": [
                { "from_hours": 6.0, "break_minutes": 30 },
                { "from_hours": 9.0, "break_minutes": 45 }
            ]
        });

        // Standard adult: 7.0h gross - 0.5h break = 6.5h net
        assert_eq!(calculate_shift_duration(&shift, &settings), 6.5);
        // Youth (<18, >6.0h gross -> 60m break under § 11 JArbSchG): 7.0h - 1.0h = 6.0h net
        assert_eq!(
            calculate_shift_duration_for_employee(&shift, &settings, "youth"),
            6.0
        );
    }
}
