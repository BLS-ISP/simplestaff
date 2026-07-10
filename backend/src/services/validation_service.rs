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
    _tenant_id: &Uuid,
    employee_id: &Uuid,
    shift_type_id: &Uuid,
    assignment_date: &NaiveDate,
    tenant_settings: &serde_json::Value,
) -> Result<Vec<ValidationWarning>, AppError> {
    let mut warnings: Vec<ValidationWarning> = Vec::new();

    // Load the shift type we're about to assign
    let shift_type = shift_type::Entity::find_by_id(*shift_type_id)
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

    // ── 1. Blocked day check ──────────────────────────────────────────────
    let blocked = employee_blocked_day::Entity::find()
        .filter(
            Condition::all()
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
    let emp = employee::Entity::find_by_id(*employee_id)
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Employee not found".to_string()))?;

    let prefs_map: std::collections::HashMap<String, i32> = serde_json::from_value(emp.shift_preferences.clone())
        .unwrap_or_default();
    let pref_key = format!("{}:{}", shift_type_id, day_of_week);
    let pref = prefs_map.get(&pref_key).copied()
        .or_else(|| prefs_map.get(&shift_type_id.to_string()).copied())
        .unwrap_or(3);

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

    // ── 3. 11-hour rest period violation ──────────────────────────────────
    let min_rest_hours = tenant_settings
        .get("min_rest_hours")
        .and_then(|v| v.as_f64())
        .unwrap_or(11.0);

    let previous_day = *assignment_date - Duration::days(1);

    let prev_day_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.eq(previous_day)),
        )
        .all(txn)
        .await?;

    let new_start = shift_type.start_time;

    for prev_assignment in &prev_day_assignments {
        let prev_shift = shift_type::Entity::find_by_id(prev_assignment.shift_type_id)
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Previous shift type not found".to_string()))?;

        let prev_end = prev_shift.end_time;

        // Calculate hours between prev shift end (previous day) and new shift start (assignment day).
        // prev_end is on previous_day, new_start is on assignment_date.
        let rest_minutes = if prev_end <= new_start {
            // e.g. prev ended at 22:00 yesterday, new starts at 10:00 today → 12h gap
            let minutes_until_midnight = minutes_from_time_to_midnight(prev_end);
            let minutes_from_midnight = minutes_from_midnight_to_time(new_start);
            minutes_until_midnight + minutes_from_midnight
        } else {
            // e.g. prev ended at 02:00 (night shift, actually today), new starts at 10:00 today
            // prev_end is already "today" for a night shift
            // The end is effectively on assignment_date already
            let diff = time_diff_minutes(prev_end, new_start);
            // If prev_end > new_start and it's a night shift from previous day,
            // the actual end is on assignment_date, so rest = new_start - prev_end (same day)
            if diff >= 0 {
                diff
            } else {
                // new_start is before prev_end on the same logical day – overlap / no rest
                0
            }
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

    // ── 4. Max daily hours exceeded ───────────────────────────────────────
    let max_daily_hours = tenant_settings
        .get("max_daily_hours")
        .and_then(|v| v.as_f64())
        .unwrap_or(10.0);

    let same_day_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.eq(*assignment_date)),
        )
        .all(txn)
        .await?;

    let mut total_daily_hours: f64 = 0.0;

    for assignment in &same_day_assignments {
        let st = shift_type::Entity::find_by_id(assignment.shift_type_id)
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

        total_daily_hours += calculate_shift_duration(&st, tenant_settings);
    }

    // Add the proposed shift's duration
    let new_shift_duration = calculate_shift_duration(&shift_type, tenant_settings);
    total_daily_hours += new_shift_duration;

    if total_daily_hours > max_daily_hours {
        warnings.push(ValidationWarning {
            code: "MAX_DAILY_HOURS".to_string(),
            message_de: format!(
                "Tägliche Arbeitszeit von {:.1}h überschreitet das Maximum von {:.0}h.",
                total_daily_hours, max_daily_hours
            ),
            message_en: format!(
                "Daily working hours of {:.1}h exceed the maximum of {:.0}h.",
                total_daily_hours, max_daily_hours
            ),
            severity: WarningSeverity::Warning,
        });
    }

    // ── 5. Weekly hours exceeded ──────────────────────────────────────────
    let employee_record = employee::Entity::find_by_id(*employee_id)
        .one(txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Employee not found".to_string()))?;

    let weekly_hours_limit = employee_record.weekly_hours as f64;

    // Calculate Monday–Sunday of the assignment week
    let weekday = assignment_date.weekday().num_days_from_monday(); // Mon=0 .. Sun=6
    let week_start = *assignment_date - Duration::days(weekday as i64);
    let week_end = week_start + Duration::days(6);

    let weekly_assignments = shift_assignment::Entity::find()
        .filter(
            Condition::all()
                .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                .add(shift_assignment::Column::AssignmentDate.gte(week_start))
                .add(shift_assignment::Column::AssignmentDate.lte(week_end)),
        )
        .all(txn)
        .await?;

    let mut total_weekly_hours: f64 = 0.0;

    for assignment in &weekly_assignments {
        let st = shift_type::Entity::find_by_id(assignment.shift_type_id)
            .one(txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Shift type not found".to_string()))?;

        total_weekly_hours += calculate_shift_duration(&st, tenant_settings);
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

    // ── 6. Weekday validity check ─────────────────────────────────────────
    let valid_days: Vec<u32> = serde_json::from_value(shift_type.valid_days.clone())
        .unwrap_or_else(|_| vec![1, 2, 3, 4, 5, 6, 7]);

    // ── 6a. Holiday validity check ────────────────────────────────────────
    let is_holiday = crate::models::closed_day::Entity::find()
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
                    .add(shift_assignment::Column::ShiftTypeId.eq(*shift_type_id))
                    .add(shift_assignment::Column::AssignmentDate.eq(*assignment_date))
            )
            .count(txn)
            .await?;

        let already_assigned = shift_assignment::Entity::find()
            .filter(
                Condition::all()
                    .add(shift_assignment::Column::EmployeeId.eq(*employee_id))
                    .add(shift_assignment::Column::ShiftTypeId.eq(*shift_type_id))
                    .add(shift_assignment::Column::AssignmentDate.eq(*assignment_date))
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

    Ok(warnings)
}

/// Calculates the effective duration of a shift in hours, accounting for night shifts
/// and automatic break deductions based on tenant settings.
fn calculate_shift_duration(
    shift: &shift_type::Model,
    tenant_settings: &serde_json::Value,
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

    // Apply break rules from tenant settings
    let break_minutes = calculate_break_minutes(gross_hours, tenant_settings);

    gross_hours - (break_minutes as f64 / 60.0)
}

/// Determines the break duration in minutes based on the gross working hours
/// and the tenant's break rules.
fn calculate_break_minutes(gross_hours: f64, tenant_settings: &serde_json::Value) -> i64 {
    let break_rules = tenant_settings
        .get("break_rules")
        .and_then(|v| v.as_array());

    let mut break_minutes: i64 = 0;

    if let Some(rules) = break_rules {
        for rule in rules {
            let min_hours = rule
                .get("min_hours")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let minutes = rule
                .get("break_minutes")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if gross_hours >= min_hours && minutes > break_minutes {
                break_minutes = minutes;
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
