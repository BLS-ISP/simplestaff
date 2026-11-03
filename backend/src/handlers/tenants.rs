use axum::{
    extract::State,
    routing::{get, put},
    Json, Router,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::errors::AppError;
use crate::handlers::admin::SystemAnnouncement;
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
        .route("/announcement", get(get_public_announcement))
}

/// GET /announcement – Return active global system announcement for any authenticated user
pub async fn get_public_announcement(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<SystemAnnouncement>, AppError> {
    let sys_tenant = tenant::Entity::find()
        .filter(tenant::Column::Slug.eq("system"))
        .one(&state.db)
        .await?;

    if let Some(st) = sys_tenant {
        if let Some(ann) = st.settings.get("system_announcement") {
            if let Ok(parsed) = serde_json::from_value::<SystemAnnouncement>(ann.clone()) {
                return Ok(Json(parsed));
            }
        }
    }

    Ok(Json(SystemAnnouncement {
        message: String::new(),
        level: "info".to_string(),
        active: false,
    }))
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

            let protected_keys = [
                "max_employees",
                "is_suspended",
                "suspension_reason",
                "license_note",
                "license_expires_at",
                "week_templates",
                "system_announcement",
            ];

            let mut new_settings = payload.settings;
            if let Some(obj) = new_settings.as_object_mut() {
                for key in protected_keys {
                    if let Some(val) = existing.settings.get(key) {
                        obj.insert(key.to_string(), val.clone());
                    } else {
                        obj.remove(key);
                    }
                }
            }

            let mut active: tenant::ActiveModel = existing.into();
            active.settings = Set(new_settings);
            active.updated_at = Set(chrono::Utc::now().into());

            let updated = active.update(txn).await?;
            Ok(updated)
        })
    })
    .await?;

    Ok(Json(TenantResponse::from(model)))
}
