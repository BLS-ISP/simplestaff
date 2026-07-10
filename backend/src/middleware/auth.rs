use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// JWT Claims
// ---------------------------------------------------------------------------

/// Claims embedded in a JWT token.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject – the user's UUID as a string.
    pub sub: String,
    /// The tenant this user belongs to.
    pub tenant_id: String,
    /// Role name (e.g. "super_admin", "admin", "planner", "viewer").
    pub role: String,
    /// Expiry (epoch seconds).
    pub exp: usize,
}

// ---------------------------------------------------------------------------
// Authenticated user (extracted from request)
// ---------------------------------------------------------------------------

/// Represents an authenticated user extracted from a valid JWT bearer token.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub role: String,
}

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    AppState: axum::extract::FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);

        // Extract the Authorization header.
        let auth_header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;

        // Strip the "Bearer " prefix.
        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("Invalid Authorization header format".to_string()))?;

        // Decode & validate.
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(app_state.config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|e| AppError::Unauthorized(format!("Invalid token: {e}")))?;

        let claims = token_data.claims;

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| AppError::Unauthorized("Invalid user id in token".to_string()))?;
        let tenant_id = Uuid::parse_str(&claims.tenant_id)
            .map_err(|_| AppError::Unauthorized("Invalid tenant id in token".to_string()))?;

        Ok(AuthUser {
            user_id,
            tenant_id,
            role: claims.role,
        })
    }
}

// ---------------------------------------------------------------------------
// Token creation helper
// ---------------------------------------------------------------------------

/// Create a signed JWT valid for 24 hours.
pub fn create_jwt(
    user_id: Uuid,
    tenant_id: Uuid,
    role: &str,
    secret: &str,
) -> Result<String, AppError> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        tenant_id: tenant_id.to_string(),
        role: role.to_string(),
        exp,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to create JWT: {e}")))
}
