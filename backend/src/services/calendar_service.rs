//! Calendar service — generates RFC 5545 ICS calendar exports and manages
//! subscription tokens for long-lived calendar feed URLs.

use chrono::Duration;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::{shift_assignment, shift_type};

// ---------------------------------------------------------------------------
// ICS generation
// ---------------------------------------------------------------------------

/// Generate an RFC 5545 compliant ICS calendar string for one employee's shift
/// assignments.
///
/// Each `(ShiftAssignment, ShiftType)` pair becomes a `VEVENT` with proper
/// `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, and `STATUS` fields.
/// The calendar uses CRLF line endings as required by the spec.
pub fn generate_ics(
    employee_name: &str,
    assignments: &[(shift_assignment::Model, shift_type::Model)],
) -> String {
    let crlf = "\r\n";
    let mut ics = String::with_capacity(4096);

    // Calendar header
    ics.push_str("BEGIN:VCALENDAR");
    ics.push_str(crlf);
    ics.push_str("VERSION:2.0");
    ics.push_str(crlf);
    ics.push_str("PRODID:-//SimpleStaff//Shift Calendar//EN");
    ics.push_str(crlf);
    ics.push_str("CALSCALE:GREGORIAN");
    ics.push_str(crlf);
    ics.push_str("METHOD:PUBLISH");
    ics.push_str(crlf);
    ics.push_str(&format!("X-WR-CALNAME:Schichten - {}", employee_name));
    ics.push_str(crlf);

    for (assignment, shift) in assignments {
        let date = assignment.assignment_date;
        let start_time = shift.start_time;
        let end_time = shift.end_time;

        // If end_time <= start_time the shift crosses midnight → end date is
        // the next day.
        let end_date = if end_time <= start_time {
            date + Duration::days(1)
        } else {
            date
        };

        let dtstart = format!(
            "{:04}{:02}{:02}T{:02}{:02}{:02}",
            date.year(),
            date.month(),
            date.day(),
            start_time.hour(),
            start_time.minute(),
            start_time.second(),
        );

        let dtend = format!(
            "{:04}{:02}{:02}T{:02}{:02}{:02}",
            end_date.year(),
            end_date.month(),
            end_date.day(),
            end_time.hour(),
            end_time.minute(),
            end_time.second(),
        );

        let status = match assignment.status.as_str() {
            "planned" | "confirmed" => "CONFIRMED",
            _ => "TENTATIVE",
        };

        ics.push_str("BEGIN:VEVENT");
        ics.push_str(crlf);
        ics.push_str(&format!("UID:{}@simplestaff.local", assignment.id));
        ics.push_str(crlf);
        ics.push_str(&format!("DTSTART:{}", dtstart));
        ics.push_str(crlf);
        ics.push_str(&format!("DTEND:{}", dtend));
        ics.push_str(crlf);
        ics.push_str(&format!("SUMMARY:{}", ics_escape(&shift.name)));
        ics.push_str(crlf);
        ics.push_str(&format!(
            "DESCRIPTION:Pause: {} Min.",
            shift.break_minutes
        ));
        ics.push_str(crlf);
        ics.push_str(&format!("STATUS:{}", status));
        ics.push_str(crlf);
        ics.push_str("END:VEVENT");
        ics.push_str(crlf);
    }

    ics.push_str("END:VCALENDAR");
    ics.push_str(crlf);

    ics
}

/// Minimal ICS text escaping: backslash-escape commas, semicolons, and
/// backslashes, and replace newlines with literal `\n`.
fn ics_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

// Bring chrono traits into scope for `.year()`, `.month()`, etc.
use chrono::Datelike;
use chrono::Timelike;

// ---------------------------------------------------------------------------
// Subscription tokens (JWT based, very long expiry)
// ---------------------------------------------------------------------------

/// JWT claims for a calendar subscription token.
#[derive(Debug, Serialize, Deserialize)]
struct SubscriptionClaims {
    /// Subject – the employee ID.
    sub: String,
    /// Tenant context.
    tenant_id: String,
    /// Expiry (Unix timestamp). Set to ~10 years from creation.
    exp: usize,
    /// Issued-at.
    iat: usize,
}

/// Create a long-lived JWT token that encodes `employee_id` and `tenant_id`.
///
/// The token is intended for unauthenticated ICS feed URLs and expires roughly
/// 10 years after creation.
pub fn create_subscription_token(
    employee_id: &Uuid,
    tenant_id: &Uuid,
    secret: &str,
) -> Result<String, AppError> {
    let now = chrono::Utc::now().timestamp() as usize;
    let ten_years = 10 * 365 * 24 * 3600; // ~10 years in seconds

    let claims = SubscriptionClaims {
        sub: employee_id.to_string(),
        tenant_id: tenant_id.to_string(),
        exp: now + ten_years,
        iat: now,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to create subscription token: {e}")))
}

/// Verify a subscription token and return `(employee_id, tenant_id)`.
pub fn verify_subscription_token(
    token: &str,
    secret: &str,
) -> Result<(Uuid, Uuid), AppError> {
    let token_data = decode::<SubscriptionClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::Unauthorized(format!("Invalid subscription token: {e}")))?;

    let employee_id = Uuid::parse_str(&token_data.claims.sub)
        .map_err(|e| AppError::BadRequest(format!("Invalid employee ID in token: {e}")))?;

    let tenant_id = Uuid::parse_str(&token_data.claims.tenant_id)
        .map_err(|e| AppError::BadRequest(format!("Invalid tenant ID in token: {e}")))?;

    Ok((employee_id, tenant_id))
}
