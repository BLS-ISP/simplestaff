use axum::{
    extract::{Path, State},
    routing::{get, put},
    Json, Router,
};
use sea_orm::{ActiveModelTrait, EntityTrait, Set, TransactionTrait};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHasher,
};

use crate::AppState;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::set_tenant_context;
use crate::models::{tenant, user};

#[derive(Debug, Serialize)]
pub struct TenantAdminResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub max_employees: Option<u64>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
    pub slug: String,
    pub max_employees: Option<u64>,
    pub manager_email: String,
    pub manager_password: String,
    pub manager_first_name: String,
    pub manager_last_name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenantRequest {
    pub name: String,
    pub slug: String,
    pub max_employees: Option<u64>,
}

fn require_super_admin(auth: &AuthUser) -> Result<(), AppError> {
    if auth.role != "super_admin" {
        return Err(AppError::Forbidden("Super-Admin-Rechte erforderlich".to_string()));
    }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenants", get(list_tenants).post(create_tenant))
        .route("/tenants/{id}", put(update_tenant).delete(delete_tenant))
}

/// GET /api/admin/tenants – List all tenants
pub async fn list_tenants(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<TenantAdminResponse>>, AppError> {
    require_super_admin(&auth)?;

    let tenants = tenant::Entity::find()
        .all(&state.db)
        .await?;

    let res = tenants
        .into_iter()
        .map(|t| {
            let max_employees = t.settings
                .get("max_employees")
                .and_then(|v| v.as_u64());
            TenantAdminResponse {
                id: t.id,
                name: t.name,
                slug: t.slug,
                max_employees,
                created_at: t.created_at,
                updated_at: t.updated_at,
            }
        })
        .collect();

    Ok(Json(res))
}

/// POST /api/admin/tenants – Create tenant + respective manager
pub async fn create_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateTenantRequest>,
) -> Result<Json<TenantAdminResponse>, AppError> {
    require_super_admin(&auth)?;

    if payload.name.trim().is_empty() || payload.slug.trim().is_empty() {
        return Err(AppError::BadRequest("Betriebsname und Slug sind erforderlich".to_string()));
    }
    if payload.manager_email.trim().is_empty() || payload.manager_password.trim().is_empty() {
        return Err(AppError::BadRequest("Manager-E-Mail und -Passwort sind erforderlich".to_string()));
    }

    let tenant_id = Uuid::new_v4();
    let now = chrono::Utc::now().fixed_offset();

    // Hash the password with Argon2
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(payload.manager_password.as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
        .to_string();

    let settings = serde_json::json!({
        "max_employees": payload.max_employees
    });

    let txn = state.db.begin().await?;

    // Create the tenant
    let new_tenant = tenant::Model {
        id: tenant_id,
        name: payload.name.clone(),
        slug: payload.slug.clone(),
        settings,
        created_at: now,
        updated_at: now,
    };
    let active_tenant: tenant::ActiveModel = new_tenant.clone().into();
    active_tenant.insert(&txn).await?;

    // Set the tenant context on the transaction before inserting user (since users has RLS)
    set_tenant_context(&txn, &tenant_id).await?;

    // Create the manager user (role "admin")
    let new_manager = user::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(tenant_id),
        email: Set(payload.manager_email),
        password_hash: Set(password_hash),
        first_name: Set(payload.manager_first_name),
        last_name: Set(payload.manager_last_name),
        role: Set("admin".to_string()),
        is_active: Set(true),
        created_at: Set(now),
        updated_at: Set(now),
    };
    new_manager.insert(&txn).await?;

    txn.commit().await?;

    Ok(Json(TenantAdminResponse {
        id: tenant_id,
        name: new_tenant.name,
        slug: new_tenant.slug,
        max_employees: payload.max_employees,
        created_at: now,
        updated_at: now,
    }))
}

/// PUT /api/admin/tenants/{id} – Update tenant details
pub async fn update_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateTenantRequest>,
) -> Result<Json<TenantAdminResponse>, AppError> {
    require_super_admin(&auth)?;

    if payload.name.trim().is_empty() || payload.slug.trim().is_empty() {
        return Err(AppError::BadRequest("Betriebsname und Slug sind erforderlich".to_string()));
    }

    let existing = tenant::Entity::find_by_id(id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Betrieb nicht gefunden".to_string()))?;

    let mut settings = existing.settings.clone();
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings["max_employees"] = serde_json::json!(payload.max_employees);

    let mut active: tenant::ActiveModel = existing.into();
    active.name = Set(payload.name);
    active.slug = Set(payload.slug);
    active.settings = Set(settings);
    active.updated_at = Set(chrono::Utc::now().fixed_offset());

    let updated = active.update(&state.db).await?;

    Ok(Json(TenantAdminResponse {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        max_employees: payload.max_employees,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
    }))
}

/// DELETE /api/admin/tenants/{id} – Delete tenant
pub async fn delete_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_super_admin(&auth)?;

    // Cascade delete is handled at the database layer (FOREIGN KEY ... ON DELETE CASCADE).
    // So deleting from tenants automatically cleans up everything.
    let result = tenant::Entity::delete_by_id(id)
        .exec(&state.db)
        .await?;

    if result.rows_affected == 0 {
        return Err(AppError::NotFound("Betrieb nicht gefunden".to_string()));
    }

    Ok(Json(serde_json::json!({ "success": true })))
}
