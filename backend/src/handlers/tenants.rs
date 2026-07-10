use axum::{
    extract::State,
    routing::{get, put},
    Json, Router,
};
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::tenant;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct TenantResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub settings: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<tenant::Model> for TenantResponse {
    fn from(m: tenant::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            slug: m.slug,
            settings: m.settings,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenantRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenantSettingsRequest {
    pub settings: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_admin(auth: &AuthUser) -> Result<(), AppError> {
    if auth.role != "admin" && auth.role != "super_admin" {
        return Err(AppError::Forbidden("Admin access required".to_string()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(get_current_tenant).put(update_tenant))
        .route("/settings", put(update_tenant_settings))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET / – Return the current tenant's info derived from the authenticated user.
pub async fn get_current_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<TenantResponse>, AppError> {
    let tenant_id = auth.tenant_id;

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            tenant::Entity::find_by_id(tenant_id)
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tenant not found".to_string()))
        })
    })
    .await?;

    Ok(Json(TenantResponse::from(model)))
}

/// PUT / – Update the tenant name. Requires admin or super_admin role.
pub async fn update_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<UpdateTenantRequest>,
) -> Result<Json<TenantResponse>, AppError> {
    require_admin(&auth)?;

    let tenant_id = auth.tenant_id;

    if payload.name.trim().is_empty() {
        return Err(AppError::BadRequest("Tenant name cannot be empty".to_string()));
    }

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = tenant::Entity::find_by_id(tenant_id)
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tenant not found".to_string()))?;

            let mut active: tenant::ActiveModel = existing.into();
            active.name = Set(payload.name);
            active.updated_at = Set(chrono::Utc::now().into());

            let updated = active.update(txn).await?;
            Ok(updated)
        })
    })
    .await?;

    Ok(Json(TenantResponse::from(model)))
}

/// PUT /settings – Replace the tenant settings JSON. Requires admin or super_admin role.
pub async fn update_tenant_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<UpdateTenantSettingsRequest>,
) -> Result<Json<TenantResponse>, AppError> {
    require_admin(&auth)?;

    let tenant_id = auth.tenant_id;

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = tenant::Entity::find_by_id(tenant_id)
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Tenant not found".to_string()))?;

            let mut active: tenant::ActiveModel = existing.into();
            active.settings = Set(payload.settings);
            active.updated_at = Set(chrono::Utc::now().into());

            let updated = active.update(txn).await?;
            Ok(updated)
        })
    })
    .await?;

    Ok(Json(TenantResponse::from(model)))
}
