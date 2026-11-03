use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, Statement,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::{create_jwt, AuthUser};
use crate::middleware::tenant::execute_with_tenant;
use crate::models::{tenant, user};
use crate::AppState;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub tenant_name: String,
    pub tenant_slug: String,
    pub email: String,
    pub password: String,
    pub first_name: String,
    pub last_name: String,
}

#[derive(Debug, Serialize)]
pub struct RegisterResponse {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: LoginUserInfo,
}

#[derive(Debug, Serialize)]
pub struct LoginUserInfo {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub tenant_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/me", get(me))
        .route("/change-password", post(change_password))
}

// ---------------------------------------------------------------------------
// POST /register
// ---------------------------------------------------------------------------

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, AppError> {
    if !state.config.allow_public_registration {
        return Err(AppError::Forbidden(
            "Die öffentliche Registrierung ist deaktiviert. Bitte wenden Sie sich an Ihren Administrator.".into(),
        ));
    }

    // Validate basic inputs
    if body.email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("Email and password are required".into()));
    }
    if body.tenant_name.is_empty() || body.tenant_slug.is_empty() {
        return Err(AppError::BadRequest(
            "Tenant name and slug are required".into(),
        ));
    }

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Failed to hash password: {e}")))?
        .to_string();

    // Use a direct transaction (no execute_with_tenant) because the tenant
    // does not exist yet and RLS context cannot be established.
    let txn = state.db.begin().await?;

    // Check for duplicate tenant slug
    let existing_tenant = tenant::Entity::find()
        .filter(tenant::Column::Slug.eq(&body.tenant_slug))
        .one(&txn)
        .await?;

    if existing_tenant.is_some() {
        return Err(AppError::Conflict(
            "A tenant with this slug already exists".into(),
        ));
    }

    // Check for duplicate email
    let existing_user = user::Entity::find()
        .filter(user::Column::Email.eq(&body.email))
        .one(&txn)
        .await?;

    if existing_user.is_some() {
        return Err(AppError::Conflict(
            "A user with this email already exists".into(),
        ));
    }

    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
    let tenant_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    // Create tenant
    let new_tenant = tenant::ActiveModel {
        id: Set(tenant_id),
        name: Set(body.tenant_name),
        slug: Set(body.tenant_slug),
        settings: Set(serde_json::json!({})),
        created_at: Set(now),
        updated_at: Set(now),
    };
    new_tenant.insert(&txn).await?;

    // Set tenant context on transaction before inserting into RLS-protected users table
    crate::middleware::tenant::set_tenant_context(&txn, &tenant_id).await?;

    // Create admin user
    let new_user = user::ActiveModel {
        id: Set(user_id),
        tenant_id: Set(tenant_id),
        email: Set(body.email),
        password_hash: Set(password_hash),
        first_name: Set(body.first_name),
        last_name: Set(body.last_name),
        role: Set("admin".to_string()),
        is_active: Set(true),
        created_at: Set(now),
        updated_at: Set(now),
    };
    new_user.insert(&txn).await?;

    txn.commit().await?;

    // Generate JWT
    let token = create_jwt(user_id, tenant_id, "admin", &state.config.jwt_secret)?;

    Ok(Json(RegisterResponse { token }))
}

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    if body.email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("Email and password are required".into()));
    }

    // Bypass RLS — we don't know the tenant yet, so use raw SQL.
    // Query all matching active rows in case the same email exists in multiple tenants.
    let results = state
        .db
        .query_all(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT id, tenant_id, email, password_hash, role, first_name, last_name, is_active
               FROM users
               WHERE LOWER(email) = LOWER($1) AND is_active = true"#,
            [body.email.trim().to_string().into()],
        ))
        .await?;

    if results.is_empty() {
        return Err(AppError::Unauthorized("Invalid email or password".into()));
    }

    let argon2 = Argon2::default();
    let mut matched_user: Option<(Uuid, Uuid, String, String)> = None;

    for row in results {
        let user_id: Uuid = row
            .try_get("", "id")
            .map_err(|e| AppError::InternalError(format!("Failed to read user id: {e}")))?;
        let tenant_id: Uuid = row
            .try_get("", "tenant_id")
            .map_err(|e| AppError::InternalError(format!("Failed to read tenant_id: {e}")))?;
        let email: String = row
            .try_get("", "email")
            .map_err(|e| AppError::InternalError(format!("Failed to read email: {e}")))?;
        let stored_hash: String = row
            .try_get("", "password_hash")
            .map_err(|e| AppError::InternalError(format!("Failed to read password_hash: {e}")))?;
        let role: String = row
            .try_get("", "role")
            .map_err(|e| AppError::InternalError(format!("Failed to read role: {e}")))?;

        if let Ok(parsed_hash) = PasswordHash::new(&stored_hash) {
            if argon2
                .verify_password(body.password.as_bytes(), &parsed_hash)
                .is_ok()
            {
                matched_user = Some((user_id, tenant_id, email, role));
                break;
            }
        }
    }

    let (user_id, tenant_id, email, role) = matched_user
        .ok_or_else(|| AppError::Unauthorized("Invalid email or password".into()))?;

    // Generate JWT
    let token = create_jwt(user_id, tenant_id, &role, &state.config.jwt_secret)?;

    Ok(Json(LoginResponse {
        token,
        user: LoginUserInfo {
            id: user_id,
            email,
            role,
            tenant_id,
        },
    }))
}

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------

pub async fn me(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<MeResponse>, AppError> {
    let tenant_id = auth_user.tenant_id;
    let user_id = auth_user.user_id;
    let user_model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("User not found".into()))
        })
    })
    .await?;

    Ok(Json(MeResponse {
        id: user_model.id,
        tenant_id: user_model.tenant_id,
        email: user_model.email,
        first_name: user_model.first_name,
        last_name: user_model.last_name,
        role: user_model.role,
        is_active: user_model.is_active,
        created_at: user_model.created_at,
        updated_at: user_model.updated_at,
    }))
}

// ---------------------------------------------------------------------------
// POST /change-password
// ---------------------------------------------------------------------------

pub async fn change_password(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.current_password.is_empty() || body.new_password.is_empty() {
        return Err(AppError::BadRequest(
            "Aktuelles und neues Passwort sind erforderlich.".into(),
        ));
    }
    if body.new_password.chars().count() < 8 {
        return Err(AppError::BadRequest(
            "Das neue Passwort muss mindestens 8 Zeichen lang sein.".into(),
        ));
    }

    let tenant_id = auth_user.tenant_id;
    let user_id = auth_user.user_id;
    let current_password = body.current_password;
    let new_password = body.new_password;

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let user_model = user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Benutzer nicht gefunden.".into()))?;

            let parsed_hash = PasswordHash::new(&user_model.password_hash)
                .map_err(|e| AppError::InternalError(format!("Failed to parse password hash: {e}")))?;

            Argon2::default()
                .verify_password(current_password.as_bytes(), &parsed_hash)
                .map_err(|_| AppError::BadRequest("Das aktuelle Passwort ist nicht korrekt.".into()))?;

            let salt = SaltString::generate(&mut OsRng);
            let new_hash = Argon2::default()
                .hash_password(new_password.as_bytes(), &salt)
                .map_err(|e| AppError::InternalError(format!("Failed to hash password: {e}")))?
                .to_string();

            let mut active: user::ActiveModel = user_model.into();
            active.password_hash = Set(new_hash);
            active.updated_at = Set(chrono::Utc::now().into());
            active.update(txn).await?;

            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Passwort erfolgreich geändert."
    })))
}
