use axum::{
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::{employee, shift_assignment, shift_type, user};
use crate::AppState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SubscriptionTokenResponse {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarSubscriptionClaims {
    pub sub: String,
    pub employee_id: Uuid,
    pub tenant_id: Uuid,
    pub role: String,
    pub exp: usize,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build an ICS calendar string for a given employee and their shift assignments.
fn build_ics(
    employee_name: &str,
    assignments: &[(shift_assignment::Model, shift_type::Model)],
) -> String {
    let mut ics = String::new();

    ics.push_str("BEGIN:VCALENDAR\r\n");
    ics.push_str("VERSION:2.0\r\n");
    ics.push_str("PRODID:-//SimpleStaff//Shift Calendar//EN\r\n");
    ics.push_str("CALSCALE:GREGORIAN\r\n");
    ics.push_str("METHOD:PUBLISH\r\n");
    ics.push_str(&format!("X-WR-CALNAME:Shifts - {}\r\n", employee_name));

    for (assignment, st) in assignments {
        let date_str = assignment.assignment_date.format("%Y%m%d").to_string();
        let start_time_str = st.start_time.format("%H%M%S").to_string();
        let end_time_str = st.end_time.format("%H%M%S").to_string();

        ics.push_str("BEGIN:VEVENT\r\n");
        ics.push_str(&format!(
            "UID:{}@simplestaff.local\r\n",
            assignment.id
        ));
        ics.push_str(&format!("DTSTART:{}T{}\r\n", date_str, start_time_str));
        ics.push_str(&format!("DTEND:{}T{}\r\n", date_str, end_time_str));
        ics.push_str(&format!("SUMMARY:{}\r\n", st.name));
        ics.push_str(&format!(
            "DESCRIPTION:Break: {}min\r\n",
            st.break_minutes
        ));
        ics.push_str("STATUS:CONFIRMED\r\n");
        ics.push_str("END:VEVENT\r\n");
    }

    ics.push_str("END:VCALENDAR\r\n");
    ics
}

/// Format an employee display name from optional first/last name fields.
fn employee_display_name(emp: &employee::Model) -> String {
    let first = emp.first_name.as_deref().unwrap_or("");
    let last = emp.last_name.as_deref().unwrap_or("");
    let full = format!("{} {}", first, last).trim().to_string();
    if full.is_empty() {
        "Unknown".to_string()
    } else {
        full
    }
}

/// Fetch shift assignments for an employee and pair them with their shift types.
async fn fetch_assignments_with_shift_types(
    db: &sea_orm::DatabaseTransaction,
    employee_id: Uuid,
) -> Result<Vec<(shift_assignment::Model, shift_type::Model)>, AppError> {
    let assignments = shift_assignment::Entity::find()
        .filter(shift_assignment::Column::EmployeeId.eq(employee_id))
        .order_by_asc(shift_assignment::Column::AssignmentDate)
        .all(db)
        .await?;

    let mut result = Vec::with_capacity(assignments.len());

    for assignment in assignments {
        let st = shift_type::Entity::find_by_id(assignment.shift_type_id)
            .one(db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Shift type {} not found",
                    assignment.shift_type_id
                ))
            })?;

        result.push((assignment, st));
    }

    Ok(result)
}

/// Core ICS generation logic for a given employee within a tenant.
async fn generate_ics_for_employee(
    db: &sea_orm::DatabaseConnection,
    tenant_id: &Uuid,
    employee_id: Uuid,
) -> Result<String, AppError> {
    execute_with_tenant(db, tenant_id, |txn| {
        Box::pin(async move {
            let emp = employee::Entity::find_by_id(employee_id)
                .one(txn)
                .await?
                .ok_or_else(|| {
                    AppError::NotFound(format!("Employee {} not found", employee_id))
                })?;

            let name = employee_display_name(&emp);
            let assignments = fetch_assignments_with_shift_types(txn, employee_id).await?;
            Ok(build_ics(&name, &assignments))
        })
    })
    .await
}

/// Parse an employee ID from a path segment that may end with `.ics`.
fn parse_employee_id_from_path(raw: &str) -> Result<Uuid, AppError> {
    let trimmed = raw.strip_suffix(".ics").unwrap_or(raw);
    Uuid::parse_str(trimmed).map_err(|_| {
        AppError::BadRequest(format!("Invalid employee ID: {}", raw))
    })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `GET /:employee_id.ics` — Authenticated ICS download for the given employee.
pub async fn get_employee_ics(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(raw_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let employee_id = parse_employee_id_from_path(&raw_id)?;

    let ics = generate_ics_for_employee(&state.db, &auth_user.tenant_id, employee_id).await?;

    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"shifts.ics\"",
            ),
        ],
        ics,
    ))
}

/// `GET /subscribe/:token` — Public (no auth) ICS endpoint using a subscription JWT.
pub async fn get_subscription_ics(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Decode the subscription token to extract employee_id and tenant_id.
    let decoding_key = jsonwebtoken::DecodingKey::from_secret(state.config.jwt_secret.as_bytes());
    let validation = {
        let mut v = jsonwebtoken::Validation::default();
        v.set_required_spec_claims(&["exp", "sub"]);
        v
    };

    let token_data = jsonwebtoken::decode::<CalendarSubscriptionClaims>(
        &token,
        &decoding_key,
        &validation,
    )
    .map_err(|e| AppError::Unauthorized(format!("Invalid subscription token: {}", e)))?;

    let claims = token_data.claims;

    if claims.role != "calendar_subscription" {
        return Err(AppError::Unauthorized(
            "Token is not a calendar subscription token".to_string(),
        ));
    }

    let ics =
        generate_ics_for_employee(&state.db, &claims.tenant_id, claims.employee_id).await?;

    Ok((
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"shifts.ics\"",
            ),
        ],
        ics,
    ))
}

/// `POST /subscribe/generate/:employee_id` — Generate a long-lived subscription
/// token for the given employee (requires auth).
pub async fn generate_subscription_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(employee_id): Path<Uuid>,
) -> Result<Json<SubscriptionTokenResponse>, AppError> {
    let tenant_id = auth_user.tenant_id;

    // Security check: if the user is a viewer (employee), they can only generate their own token.
    if auth_user.role == "viewer" {
        let is_own_profile = execute_with_tenant(&state.db, &tenant_id, |txn| {
            let user_id = auth_user.user_id;
            Box::pin(async move {
                let user_model = user::Entity::find_by_id(user_id)
                    .one(txn)
                    .await?
                    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
                
                let emp_model = employee::Entity::find()
                    .filter(employee::Column::Email.eq(user_model.email))
                    .one(txn)
                    .await?;
                
                if let Some(emp) = emp_model {
                    Ok(emp.id == employee_id)
                } else {
                    Ok(false)
                }
            })
        })
        .await?;

        if !is_own_profile {
            return Err(AppError::Forbidden("Sie dürfen nur für Ihr eigenes Profil einen Kalender-Abo-Link generieren.".to_string()));
        }
    }

    // Verify the employee exists within the tenant.
    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            employee::Entity::find_by_id(employee_id)
                .one(txn)
                .await?
                .ok_or_else(|| {
                    AppError::NotFound(format!("Employee {} not found in tenant", employee_id))
                })?;
            Ok(())
        })
    })
    .await?;

    // Build subscription-specific claims with a very long expiry (10 years).
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(3650))
        .unwrap()
        .timestamp() as usize;

    let claims = CalendarSubscriptionClaims {
        sub: employee_id.to_string(),
        employee_id,
        tenant_id,
        role: "calendar_subscription".to_string(),
        exp,
    };

    let encoding_key =
        jsonwebtoken::EncodingKey::from_secret(state.config.jwt_secret.as_bytes());
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &encoding_key,
    )
    .map_err(|e| AppError::InternalError(format!("Failed to create subscription token: {}", e)))?;

    Ok(Json(SubscriptionTokenResponse { token }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Mount all calendar routes on an `axum::Router`.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/subscribe/{token}", get(get_subscription_ics))
        .route(
            "/subscribe/generate/{employee_id}",
            post(generate_subscription_token),
        )
        .route("/{employee_id}", get(get_employee_ics))
}
