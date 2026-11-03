use chrono::{Datelike, Duration, NaiveDate, NaiveTime};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::tenant::set_tenant_context;
use crate::models::{
    closed_day, employee, employee_blocked_day, employee_vacation,
    shift_assignment::{self, ActiveModel, Entity as ShiftAssignment},
    shift_swap,
    shift_type::{self, Entity as ShiftType},
};
use crate::services::validation_service::{
    calculate_shift_duration_for_employee, effective_max_consecutive_days,
    effective_max_daily_hours, effective_max_weekly_hours, effective_min_rest_hours,
    is_night_shift, month_bounds, violates_protected_time_window,
};

fn calculate_rest(prev_start: NaiveTime, prev_end: NaiveTime, next_start: NaiveTime) -> f64 {
    let is_overnight = prev_end < prev_start;
    if is_overnight {
        // Shift started yesterday and ended today at prev_end
        if next_start > prev_end {
            (next_start - prev_end).num_seconds() as f64 / 3600.0
        } else {
            0.0
        }
    } else {
        // Shift ended yesterday before midnight
        let midnight = chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap();
        let hours_to_midnight = (midnight - prev_end).num_seconds() as f64 / 3600.0 + 1.0 / 3600.0;
        let midnight_start = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap();
        let hours_from_midnight = (next_start - midnight_start).num_seconds() as f64 / 3600.0;
        hours_to_midnight + hours_from_midnight
    }
}

struct TempAssignment {
    employee_id: Uuid,
    shift_type_id: Uuid,
    date: NaiveDate,
    start_time: NaiveTime,
    end_time: NaiveTime,
    duration: f64,
    is_new: bool,
}

pub async fn run_auto_schedule(
    db: &DatabaseConnection,
    tenant_id: &Uuid,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<(), AppError> {
    let txn = db.begin().await?;
    set_tenant_context(&txn, tenant_id).await?;

    // 1. Fetch Tenant details & Settings
    let tenant = crate::models::tenant::Entity::find_by_id(*tenant_id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Tenant {tenant_id} not found")))?;

    let tenant_settings = tenant.settings.as_object();
    let max_daily_hours = tenant_settings
        .and_then(|s| s.get("max_daily_hours"))
        .and_then(|v| v.as_f64())
        .unwrap_or(10.0);

    let tenant_max_weekly_hours = tenant_settings
        .and_then(|s| s.get("max_weekly_hours"))
        .and_then(|v| v.as_f64());

    let min_rest_hours = tenant_settings
        .and_then(|s| s.get("min_rest_hours"))
        .and_then(|v| v.as_f64())
        .unwrap_or(11.0);

    let tenant_max_consecutive_days = tenant_settings
        .and_then(|s| s.get("max_consecutive_days"))
        .and_then(|v| v.as_u64())
        .unwrap_or(6) as u32;

    let max_consecutive_night_shifts = tenant_settings
        .and_then(|s| s.get("max_consecutive_night_shifts"))
        .and_then(|v| v.as_u64())
        .unwrap_or(4) as u32;

    // 2. Fetch active employees & all shift types
    let active_employees = employee::Entity::find()
        .filter(employee::Column::TenantId.eq(*tenant_id))
        .filter(employee::Column::IsActive.eq(true))
        .all(&txn)
        .await?;

    let all_shift_types = ShiftType::find()
        .filter(shift_type::Column::TenantId.eq(*tenant_id))
        .all(&txn)
        .await?;
    let active_shift_types: Vec<&shift_type::Model> = all_shift_types
        .iter()
        .filter(|st| st.is_active)
        .collect();

    // 3. Fetch vacations, blocked days, and closed days in the range
    let vacations = employee_vacation::Entity::find()
        .filter(employee_vacation::Column::TenantId.eq(*tenant_id))
        .filter(employee_vacation::Column::Status.eq("approved"))
        .filter(
            employee_vacation::Column::StartDate.lte(end_date)
                .and(employee_vacation::Column::EndDate.gte(start_date)),
        )
        .all(&txn)
        .await?;

    let blocked_days = employee_blocked_day::Entity::find()
        .filter(employee_blocked_day::Column::TenantId.eq(*tenant_id))
        .filter(employee_blocked_day::Column::BlockedDate.gte(start_date))
        .filter(employee_blocked_day::Column::BlockedDate.lte(end_date))
        .all(&txn)
        .await?;

    let closed_days = closed_day::Entity::find()
        .filter(closed_day::Column::TenantId.eq(*tenant_id))
        .filter(closed_day::Column::ClosedDate.gte(start_date))
        .filter(closed_day::Column::ClosedDate.lte(end_date))
        .all(&txn)
        .await?;

    // 4. Determine query bounds covering calendar weeks, full months, and 14-day streak lookback/lookahead
    let weekday_start = start_date.weekday().num_days_from_monday();
    let (start_month_first, _) = month_bounds(start_date);
    let query_start = (start_date - Duration::days(weekday_start as i64))
        .min(start_date - Duration::days(14))
        .min(start_month_first);

    let weekday_end = end_date.weekday().num_days_from_monday();
    let (_, end_month_last) = month_bounds(end_date);
    let query_end = (end_date + Duration::days((6 - weekday_end) as i64))
        .max(end_date + Duration::days(14))
        .max(end_month_last);

    let all_range_assignments = ShiftAssignment::find()
        .filter(shift_assignment::Column::TenantId.eq(*tenant_id))
        .filter(shift_assignment::Column::AssignmentDate.gte(query_start))
        .filter(shift_assignment::Column::AssignmentDate.lte(query_end))
        .all(&txn)
        .await?;

    let active_swaps = shift_swap::Entity::find()
        .filter(shift_swap::Column::TenantId.eq(*tenant_id))
        .filter(shift_swap::Column::Status.ne("cancelled"))
        .all(&txn)
        .await?;
    let swapped_assignment_ids: std::collections::HashSet<Uuid> =
        active_swaps.into_iter().map(|s| s.assignment_id).collect();

    // 5. Build in-memory assignments tracker (border assignments + preserved assignments inside range)
    let mut assignments: Vec<TempAssignment> = Vec::new();
    let mut deletable_assignment_ids: Vec<Uuid> = Vec::new();
    let mut sick_emp_dates: std::collections::HashSet<(Uuid, NaiveDate)> = std::collections::HashSet::new();

    for ass in &all_range_assignments {
        if ass.status == "sick" {
            // Preserve sick records in DB, block that employee on that day,
            // and do not count toward shift staffing so a replacement is scheduled.
            sick_emp_dates.insert((ass.employee_id, ass.assignment_date));
            continue;
        }

        let in_target_range = ass.assignment_date >= start_date && ass.assignment_date <= end_date;
        let is_preserved = !in_target_range
            || ass.status != "planned"
            || swapped_assignment_ids.contains(&ass.id);

        if is_preserved {
            if let Some(st) = all_shift_types.iter().find(|t| t.id == ass.shift_type_id) {
                let emp_profile = active_employees
                    .iter()
                    .find(|e| e.id == ass.employee_id)
                    .map(employee::get_protection_profile)
                    .unwrap_or("standard");
                assignments.push(TempAssignment {
                    employee_id: ass.employee_id,
                    shift_type_id: ass.shift_type_id,
                    date: ass.assignment_date,
                    start_time: st.start_time,
                    end_time: st.end_time,
                    duration: calculate_shift_duration_for_employee(st, &tenant.settings, emp_profile),
                    is_new: false,
                });
            }
        } else {
            deletable_assignment_ids.push(ass.id);
        }
    }

    // 6. Define helper validation closures/functions on our TempAssignment state
    let get_weekly_hours = |emp_id: Uuid, monday: NaiveDate, ass_list: &[TempAssignment]| -> f64 {
        let sunday = monday + Duration::days(6);
        ass_list
            .iter()
            .filter(|a| a.employee_id == emp_id && a.date >= monday && a.date <= sunday)
            .map(|a| a.duration)
            .sum()
    };

    let get_monthly_hours = |emp_id: Uuid, date: NaiveDate, ass_list: &[TempAssignment]| -> f64 {
        let (month_start, month_end) = month_bounds(date);
        ass_list
            .iter()
            .filter(|a| a.employee_id == emp_id && a.date >= month_start && a.date <= month_end)
            .map(|a| a.duration)
            .sum()
    };

    let get_daily_hours = |emp_id: Uuid, date: NaiveDate, ass_list: &[TempAssignment]| -> f64 {
        ass_list
            .iter()
            .filter(|a| a.employee_id == emp_id && a.date == date)
            .map(|a| a.duration)
            .sum()
    };

    let is_assigned = |emp_id: Uuid, date: NaiveDate, ass_list: &[TempAssignment]| -> bool {
        ass_list
            .iter()
            .any(|a| a.employee_id == emp_id && a.date == date)
    };

    let get_consecutive_days_if_assigned =
        |emp_id: Uuid, date: NaiveDate, ass_list: &[TempAssignment]| -> u32 {
            let mut before = 0u32;
            let mut d_prev = date - Duration::days(1);
            while is_assigned(emp_id, d_prev, ass_list) {
                before += 1;
                d_prev -= Duration::days(1);
            }
            let mut after = 0u32;
            let mut d_next = date + Duration::days(1);
            while is_assigned(emp_id, d_next, ass_list) {
                after += 1;
                d_next += Duration::days(1);
            }
            before + 1 + after
        };

    let has_night_shift_on = |emp_id: Uuid, date: NaiveDate, ass_list: &[TempAssignment]| -> bool {
        ass_list
            .iter()
            .any(|a| a.employee_id == emp_id && a.date == date && is_night_shift(a.start_time, a.end_time))
    };

    let get_consecutive_nights_if_assigned =
        |emp_id: Uuid, date: NaiveDate, ass_list: &[TempAssignment]| -> u32 {
            let mut before = 0u32;
            let mut d_prev = date - Duration::days(1);
            while has_night_shift_on(emp_id, d_prev, ass_list) {
                before += 1;
                d_prev -= Duration::days(1);
            }
            let mut after = 0u32;
            let mut d_next = date + Duration::days(1);
            while has_night_shift_on(emp_id, d_next, ass_list) {
                after += 1;
                d_next += Duration::days(1);
            }
            before + 1 + after
        };

    // 7. Core Greedy Solver Loop
    let mut current_date = start_date;
    while current_date <= end_date {
        // A. Skip closed days
        let day_closure = closed_days.iter().find(|cd| cd.closed_date == current_date);
        if let Some(cd) = day_closure {
            if !cd.is_holiday {
                current_date = current_date.succ_opt().unwrap();
                continue;
            }
        }

        let is_hol = day_closure.map(|cd| cd.is_holiday).unwrap_or(false);
        let day_of_week = current_date.weekday().number_from_monday();

        // B. Find valid shift types for this date
        let day_shift_types: Vec<&shift_type::Model> = active_shift_types
            .iter()
            .filter(|st| {
                let valid_days: Vec<u32> = serde_json::from_value(st.valid_days.clone()).unwrap_or_default();
                if !valid_days.contains(&day_of_week) {
                    return false;
                }
                if is_hol {
                    st.holiday_mode != "no_holidays"
                } else {
                    st.holiday_mode != "only_holidays"
                }
            })
            .copied()
            .collect();

        // C. Staff each shift type
        for st in day_shift_types {
            let min_required = st.min_staff.unwrap_or(1).max(1) as usize;
            let already_staffed = assignments
                .iter()
                .filter(|a| a.date == current_date && a.shift_type_id == st.id)
                .count();
            if already_staffed >= min_required {
                continue;
            }
            let needed = min_required - already_staffed;
            let mut candidates = Vec::new();
            let shift_is_night = is_night_shift(st.start_time, st.end_time);

            for emp in &active_employees {
                let protection_profile = employee::get_protection_profile(emp);

                // Statutory JArbSchG & MuSchG time window and Sunday/Holiday checks
                if violates_protected_time_window(st.start_time, st.end_time, protection_profile).is_some() {
                    continue;
                }
                if protection_profile == "youth" && (day_of_week == 7 || is_hol) {
                    continue;
                }
                if protection_profile == "youth_hospitality" && day_of_week == 7 {
                    let prev_sunday = current_date - Duration::days(7);
                    let next_sunday = current_date + Duration::days(7);
                    if is_assigned(emp.id, prev_sunday, &assignments)
                        || is_assigned(emp.id, next_sunday, &assignments)
                    {
                        continue;
                    }
                }

                // Check approved vacation
                let has_vacation = vacations
                    .iter()
                    .any(|v| v.employee_id == emp.id && current_date >= v.start_date && current_date <= v.end_date);
                if has_vacation {
                    continue;
                }

                // Check blocked day
                let is_blocked = blocked_days
                    .iter()
                    .any(|b| b.employee_id == emp.id && b.blocked_date == current_date);
                if is_blocked {
                    continue;
                }

                // Check double assignment or sick leave on this day
                if is_assigned(emp.id, current_date, &assignments)
                    || sick_emp_dates.contains(&(emp.id, current_date))
                {
                    continue;
                }

                // Check daily limit (accounting for JArbSchG / MuSchG)
                let shift_dur = calculate_shift_duration_for_employee(st, &tenant.settings, protection_profile);
                let day_hours = get_daily_hours(emp.id, current_date, &assignments);
                let emp_max_daily = effective_max_daily_hours(max_daily_hours, protection_profile);
                if day_hours + shift_dur > emp_max_daily {
                    continue;
                }

                // Check weekly limit (employee weekly_hours, tenant max_weekly_hours, and JArbSchG/MuSchG 40h cap)
                let current_weekday = current_date.weekday().num_days_from_monday();
                let week_monday = current_date - Duration::days(current_weekday as i64);
                let week_hours = get_weekly_hours(emp.id, week_monday, &assignments);
                let emp_weekly_limit = effective_max_weekly_hours(
                    emp.weekly_hours as f64,
                    tenant_max_weekly_hours,
                    protection_profile,
                );
                if week_hours + shift_dur > emp_weekly_limit {
                    continue;
                }

                // Check monthly hours limit (Minijob / Vertragskontingent)
                if let Some(monthly_max) = emp.monthly_hours.filter(|&m| m > 0.0) {
                    let month_hours = get_monthly_hours(emp.id, current_date, &assignments);
                    if month_hours + shift_dur > monthly_max as f64 {
                        continue;
                    }
                }

                // Check max consecutive working days (§ 11 Abs. 3 ArbZG / § 15 JArbSchG)
                let emp_max_consec = effective_max_consecutive_days(tenant_max_consecutive_days, protection_profile);
                if get_consecutive_days_if_assigned(emp.id, current_date, &assignments) > emp_max_consec {
                    continue;
                }

                // Check max consecutive night shifts (§ 6 Abs. 1 ArbZG)
                if shift_is_night
                    && get_consecutive_nights_if_assigned(emp.id, current_date, &assignments)
                        > max_consecutive_night_shifts
                {
                    continue;
                }

                // Check rest period against previous day AND next day (accounting for 12h JArbSchG / 11h MuSchG)
                let emp_min_rest = effective_min_rest_hours(min_rest_hours, protection_profile);
                let prev_date = current_date.pred_opt().unwrap();
                let violates_prev_rest = assignments
                    .iter()
                    .filter(|a| a.employee_id == emp.id && a.date == prev_date)
                    .any(|a| calculate_rest(a.start_time, a.end_time, st.start_time) < emp_min_rest);
                if violates_prev_rest {
                    continue;
                }

                let next_date = current_date.succ_opt().unwrap();
                let violates_next_rest = assignments
                    .iter()
                    .filter(|a| a.employee_id == emp.id && a.date == next_date)
                    .any(|a| calculate_rest(st.start_time, st.end_time, a.start_time) < emp_min_rest);
                if violates_next_rest {
                    continue;
                }

                // Candidate is eligible! Compute score.
                let pref = employee::get_shift_pref(emp, &st.id, day_of_week);
                
                // If pref is 1 (Sperrzeit), skip this candidate entirely for this shift
                if pref == 1 {
                    continue;
                }

                let week_ratio = week_hours / emp_weekly_limit.max(1.0);
                let score = pref as f64 - week_ratio * 10.0;

                candidates.push((emp, score, shift_dur));
            }

            // Sort candidate employees by score descending
            candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

            // Assign top scoring candidates
            let to_assign = needed.min(candidates.len());
            for i in 0..to_assign {
                let (emp, _, shift_dur) = candidates[i];
                assignments.push(TempAssignment {
                    employee_id: emp.id,
                    shift_type_id: st.id,
                    date: current_date,
                    start_time: st.start_time,
                    end_time: st.end_time,
                    duration: shift_dur,
                    is_new: true,
                });
            }
        }

        current_date = current_date.succ_opt().unwrap();
    }

    // 8. Delete replaceable planned assignments and insert new assignments in range within the same transaction
    if !deletable_assignment_ids.is_empty() {
        ShiftAssignment::delete_many()
            .filter(shift_assignment::Column::TenantId.eq(*tenant_id))
            .filter(shift_assignment::Column::Id.is_in(deletable_assignment_ids))
            .exec(&txn)
            .await?;
    }

    // Insert new generated assignments
    let new_assignments: Vec<ActiveModel> = assignments
        .into_iter()
        .filter(|a| a.is_new && a.date >= start_date && a.date <= end_date)
        .map(|a| ActiveModel {
            id: Set(Uuid::new_v4()),
            tenant_id: Set(*tenant_id),
            employee_id: Set(a.employee_id),
            shift_type_id: Set(a.shift_type_id),
            assignment_date: Set(a.date),
            status: Set("planned".to_string()),
            actual_start: Set(None),
            actual_end: Set(None),
            actual_break_minutes: Set(None),
            notes: Set(None),
            created_at: Set(chrono::Utc::now().into()),
            updated_at: Set(chrono::Utc::now().into()),
        })
        .collect();

    if !new_assignments.is_empty() {
        ShiftAssignment::insert_many(new_assignments).exec(&txn).await?;
    }

    txn.commit().await?;

    Ok(())
}
