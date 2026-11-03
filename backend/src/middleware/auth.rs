use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::user;
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
    /// User IDs across tenants that have been password-verified in this session.
    #[serde(default)]
    pub verified_user_ids: Vec<Uuid>,
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
    pub verified_user_ids: Vec<Uuid>,
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

        if !matches!(
            claims.role.as_str(),
            "super_admin" | "admin" | "planner" | "viewer"
        ) {
            return Err(AppError::Unauthorized(
                "Invalid role in token".to_string(),
            ));
        }

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| AppError::Unauthorized("Invalid user id in token".to_string()))?;
        let tenant_id = Uuid::parse_str(&claims.tenant_id)
            .map_err(|_| AppError::Unauthorized("Invalid tenant id in token".to_string()))?;

        // Verify live user status and current role in the database so that
        // deactivated/deleted accounts or role changes take effect immediately.
        let (live_user, tenant_model) = execute_with_tenant(&app_state.db, &tenant_id, |txn| {
            Box::pin(async move {
                let u = user::Entity::find()
                    .filter(user::Column::Id.eq(user_id))
                    .filter(user::Column::TenantId.eq(tenant_id))
                    .one(txn)
                    .await
                    .map_err(AppError::from)?
                    .ok_or_else(|| AppError::Unauthorized("Benutzerkonto existiert nicht mehr".to_string()))?;

                let t = crate::models::tenant::Entity::find_by_id(tenant_id)
                    .one(txn)
                    .await
                    .map_err(AppError::from)?
                    .ok_or_else(|| AppError::Unauthorized("Mandant existiert nicht mehr".to_string()))?;

                Ok((u, t))
            })
        })
        .await?;

        if !live_user.is_active {
            return Err(AppError::Unauthorized(
                "Benutzerkonto ist deaktiviert".to_string(),
            ));
        }

        if !matches!(
            live_user.role.as_str(),
            "super_admin" | "admin" | "planner" | "viewer"
        ) {
            return Err(AppError::Unauthorized(
                "Invalid role in user account".to_string(),
            ));
        }

        if live_user.role != "super_admin" {
            crate::models::tenant::check_tenant_license_active(&tenant_model.settings)?;
        }

        let mut verified = claims.verified_user_ids;
        if !verified.contains(&user_id) {
            verified.push(user_id);
        }

        Ok(AuthUser {
            user_id,
            tenant_id,
            role: live_user.role,
            verified_user_ids: verified,
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
    create_jwt_with_verified(user_id, tenant_id, role, vec![user_id], secret)
}

/// Create a signed JWT valid for 24 hours with a list of password-verified user IDs across tenants.
pub fn create_jwt_with_verified(
    user_id: Uuid,
    tenant_id: Uuid,
    role: &str,
    mut verified_user_ids: Vec<Uuid>,
    secret: &str,
) -> Result<String, AppError> {
    if !verified_user_ids.contains(&user_id) {
        verified_user_ids.push(user_id);
    }

    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        tenant_id: tenant_id.to_string(),
        role: role.to_string(),
        exp,
        verified_user_ids,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("Failed to create JWT: {e}")))
}
