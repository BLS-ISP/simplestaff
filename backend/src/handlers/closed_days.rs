use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::Deserialize;
use uuid::Uuid;
use chrono::{Datelike, Duration, NaiveDate};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::closed_day::{self, ActiveModel, Column, Entity as ClosedDay};
use crate::AppState;

#[derive(Deserialize)]
pub struct ListQuery {
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct CreateClosedDayInput {
    pub closed_date: NaiveDate,
    pub description: String,
    pub is_holiday: bool,
}

#[derive(Deserialize)]
pub struct GenerateHolidaysInput {
    pub year: i32,
    pub state: String,
}

fn require_manager(auth: &AuthUser) -> Result<(), AppError> {
    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => Ok(()),
        _ => Err(AppError::Forbidden("Manager access required".to_string())),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_closed_days).post(create_closed_day))
        .route("/generate-holidays", post(generate_holidays))
        .route("/{id}", axum::routing::delete(delete_closed_day))
}

pub async fn list_closed_days(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<closed_day::Model>>, AppError> {
    let tenant_id = auth.tenant_id;

    let closed_days = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let mut q = ClosedDay::find()
                .filter(Column::TenantId.eq(tenant_id))
                .order_by_asc(Column::ClosedDate);

            if let Some(start) = query.start_date {
                q = q.filter(Column::ClosedDate.gte(start));
            }
            if let Some(end) = query.end_date {
                q = q.filter(Column::ClosedDate.lte(end));
            }

            q.all(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(closed_days))
}

pub async fn create_closed_day(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<CreateClosedDayInput>,
) -> Result<Json<closed_day::Model>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;
    let now = chrono::Utc::now().fixed_offset();

    let closed_day = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            // Check if closed day already exists for this date
            let existing = ClosedDay::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::ClosedDate.eq(input.closed_date))
                .one(txn)
                .await?;

            if existing.is_some() {
                return Err(AppError::BadRequest("Für dieses Datum existiert bereits ein Eintrag.".to_string()));
            }

            let active_model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                closed_date: Set(input.closed_date),
                description: Set(input.description),
                is_holiday: Set(input.is_holiday),
                created_at: Set(now),
                updated_at: Set(now),
            };

            active_model.insert(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(closed_day))
}

pub async fn delete_closed_day(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let tenant_id = auth.tenant_id;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let delete_res = ClosedDay::delete_many()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;
            if delete_res.rows_affected == 0 {
                return Err(AppError::NotFound(format!("Closed day {id} not found")));
            }
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "success": true, "message": "Eintrag erfolgreich gelöscht." })))
}

fn calculate_easter_sunday(year: i32) -> Option<NaiveDate> {
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = ((h + l - 7 * m + 114) % 31) + 1;
    NaiveDate::from_ymd_opt(year, month as u32, day as u32)
}

fn german_holidays_for_state(year: i32, state: &str) -> Vec<(NaiveDate, String)> {
    let mut list: Vec<(NaiveDate, String)> = Vec::new();
    let easter = match calculate_easter_sunday(year) {
        Some(d) => d,
        None => return list,
    };

    let mut add = |opt_date: Option<NaiveDate>, name: &str| {
        if let Some(d) = opt_date {
            list.push((d, name.to_string()));
        }
    };

    // 9 bundesweite Feiertage
    add(NaiveDate::from_ymd_opt(year, 1, 1), "Neujahr");
    add(Some(easter - Duration::days(2)), "Karfreitag");
    add(Some(easter + Duration::days(1)), "Ostermontag");
    add(NaiveDate::from_ymd_opt(year, 5, 1), "Tag der Arbeit");
    add(Some(easter + Duration::days(39)), "Christi Himmelfahrt");
    add(Some(easter + Duration::days(50)), "Pfingstmontag");
    add(NaiveDate::from_ymd_opt(year, 10, 3), "Tag der Deutschen Einheit");
    add(NaiveDate::from_ymd_opt(year, 12, 25), "1. Weihnachtstag");
    add(NaiveDate::from_ymd_opt(year, 12, 26), "2. Weihnachtstag");

    // Landesfeiertage
    match state {
        "BW" | "BY" | "ST" => {
            add(NaiveDate::from_ymd_opt(year, 1, 6), "Heilige Drei Könige");
        }
        _ => {}
    }

    if matches!(state, "BE" | "MV") {
        add(NaiveDate::from_ymd_opt(year, 3, 8), "Internationaler Frauentag");
    }

    if state == "BB" {
        add(Some(easter), "Ostersonntag");
        add(Some(easter + Duration::days(49)), "Pfingstsonntag");
    }

    if matches!(state, "BW" | "BY" | "HE" | "NW" | "RP" | "SL") {
        add(Some(easter + Duration::days(60)), "Fronleichnam");
    }

    if matches!(state, "BY" | "SL") {
        add(NaiveDate::from_ymd_opt(year, 8, 15), "Mariä Himmelfahrt");
    }

    if state == "TH" {
        add(NaiveDate::from_ymd_opt(year, 9, 20), "Weltkindertag");
    }

    if matches!(state, "BB" | "HB" | "HH" | "MV" | "NI" | "SN" | "ST" | "SH" | "TH") {
        add(NaiveDate::from_ymd_opt(year, 10, 31), "Reformationstag");
    }

    if matches!(state, "BW" | "BY" | "NW" | "RP" | "SL") {
        add(NaiveDate::from_ymd_opt(year, 11, 1), "Allerheiligen");
    }

    if state == "SN" {
        // Buß- und Bettag: Mittwoch vor dem 23. November (zwischen 16. und 22. November)
        if let Some(nov22) = NaiveDate::from_ymd_opt(year, 11, 22) {
            let wd = nov22.weekday().number_from_monday() as i64; // Mon=1..Sun=7, Wed=3
            let diff = (wd - 3 + 7) % 7;
            add(Some(nov22 - Duration::days(diff)), "Buß- und Bettag");
        }
    }

    list.sort_by_key(|(d, _)| *d);
    list
}

pub async fn generate_holidays(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(input): Json<GenerateHolidaysInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    if input.year < 2020 || input.year > 2100 {
        return Err(AppError::BadRequest(
            "Bitte wählen Sie ein gültiges Jahr zwischen 2020 und 2100.".to_string(),
        ));
    }

    let state_code = input.state.trim().to_uppercase();
    let valid_states = [
        "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
    ];
    if !valid_states.contains(&state_code.as_str()) {
        return Err(AppError::BadRequest(
            "Ungültiges Bundesland-Kürzel.".to_string(),
        ));
    }

    let holidays = german_holidays_for_state(input.year, &state_code);
    let tenant_id = auth.tenant_id;
    let now = chrono::Utc::now().fixed_offset();

    let (created_count, skipped_count) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let start_of_year = NaiveDate::from_ymd_opt(input.year, 1, 1).unwrap();
            let end_of_year = NaiveDate::from_ymd_opt(input.year, 12, 31).unwrap();

            let existing = ClosedDay::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::ClosedDate.gte(start_of_year))
                .filter(Column::ClosedDate.lte(end_of_year))
                .all(txn)
                .await?;

            let existing_dates: std::collections::HashSet<NaiveDate> =
                existing.into_iter().map(|c| c.closed_date).collect();

            let mut created = 0usize;
            let mut skipped = 0usize;

            for (date, name) in holidays {
                if existing_dates.contains(&date) {
                    skipped += 1;
                    continue;
                }
                let active = ActiveModel {
                    id: Set(Uuid::new_v4()),
                    tenant_id: Set(tenant_id),
                    closed_date: Set(date),
                    description: Set(name),
                    is_holiday: Set(true),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                active.insert(txn).await?;
                created += 1;
            }

            Ok((created, skipped))
        })
    })
    .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "created_count": created_count,
        "skipped_count": skipped_count,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_easter_sunday_2026() {
        let easter = calculate_easter_sunday(2026).unwrap();
        assert_eq!(easter, NaiveDate::from_ymd_opt(2026, 4, 5).unwrap());
    }

    #[test]
    fn test_german_holidays_nw_and_sn() {
        let nw = german_holidays_for_state(2026, "NW");
        // 9 federal + Fronleichnam + Allerheiligen = 11
        assert_eq!(nw.len(), 11);
        assert!(nw.iter().any(|(d, n)| *d == NaiveDate::from_ymd_opt(2026, 6, 4).unwrap() && n == "Fronleichnam"));
        assert!(nw.iter().any(|(d, n)| *d == NaiveDate::from_ymd_opt(2026, 11, 1).unwrap() && n == "Allerheiligen"));

        let sn = german_holidays_for_state(2026, "SN");
        // 9 federal + Reformationstag + Buß- und Bettag (2026-11-18) = 11
        assert_eq!(sn.len(), 11);
        assert!(sn.iter().any(|(d, n)| *d == NaiveDate::from_ymd_opt(2026, 11, 18).unwrap() && n == "Buß- und Bettag"));
    }
}
