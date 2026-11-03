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
use crate::middleware::auth::{create_jwt, create_jwt_with_verified, AuthUser};
use crate::middleware::tenant::execute_with_tenant;
use crate::models::{employee, tenant, user};
use crate::AppState;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub tenant_name: String,
    pub tenant_slug: String,
    pub email: String,
    pub username: Option<String>,
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
    /// Accepts either email address or username
    pub email: String,
    pub password: String,
    /// Optional target tenant_id when logging into a specific tenant among multiple matches
    pub tenant_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TenantChoiceInfo {
    pub tenant_id: Uuid,
    pub tenant_name: String,
    pub tenant_slug: String,
    pub user_id: Uuid,
    pub username: Option<String>,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: Option<LoginUserInfo>,
    #[serde(default)]
    pub requires_tenant_selection: bool,
    #[serde(default)]
    pub available_tenants: Vec<TenantChoiceInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LoginUserInfo {
    pub id: Uuid,
    pub email: String,
    pub username: Option<String>,
    pub role: String,
    pub tenant_id: Uuid,
    pub tenant_name: String,
    pub tenant_slug: String,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub tenant_name: String,
    pub tenant_slug: String,
    pub email: String,
    pub username: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub is_active: bool,
    pub employee_id: Option<Uuid>,
    pub available_tenants: Vec<TenantChoiceInfo>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Debug, Deserialize)]
pub struct SwitchTenantRequest {
    pub tenant_id: Uuid,
    pub password: Option<String>,
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
        .route("/switch-tenant", post(switch_tenant))
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

    if body.email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("Email and password are required".into()));
    }
    if body.tenant_name.is_empty() || body.tenant_slug.is_empty() {
        return Err(AppError::BadRequest(
            "Tenant name and slug are required".into(),
        ));
    }

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Failed to hash password: {e}")))?
        .to_string();

    let txn = state.db.begin().await?;

    let existing_tenant = tenant::Entity::find()
        .filter(tenant::Column::Slug.eq(&body.tenant_slug))
        .one(&txn)
        .await?;

    if existing_tenant.is_some() {
        return Err(AppError::Conflict(
            "A tenant with this slug already exists".into(),
        ));
    }

    let final_username = if let Some(ref raw_uname) = body.username.as_ref().filter(|s| !s.trim().is_empty()) {
        let validated = user::validate_username_format(raw_uname)?;
        if user::is_username_taken(&txn, &validated, None).await? {
            return Err(AppError::Conflict(
                "Dieser Benutzername ist bereits vergeben.".into(),
            ));
        }
        validated
    } else {
        user::generate_unique_username(&txn, &body.email, &body.tenant_slug, None).await?
    };

    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
    let tenant_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    let new_tenant = tenant::ActiveModel {
        id: Set(tenant_id),
        name: Set(body.tenant_name),
        slug: Set(body.tenant_slug),
        settings: Set(serde_json::json!({})),
        created_at: Set(now),
        updated_at: Set(now),
    };
    new_tenant.insert(&txn).await?;

    crate::middleware::tenant::set_tenant_context(&txn, &tenant_id).await?;

    let new_user = user::ActiveModel {
        id: Set(user_id),
        tenant_id: Set(tenant_id),
        email: Set(body.email.trim().to_string()),
        username: Set(Some(final_username)),
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

    let token = create_jwt(user_id, tenant_id, "admin", &state.config.jwt_secret)?;

    Ok(Json(RegisterResponse { token }))
}

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct CandidateUserRow {
    user_id: Uuid,
    tenant_id: Uuid,
    tenant_name: String,
    tenant_slug: String,
    email: String,
    username: Option<String>,
    password_hash: String,
    role: String,
}

async fn query_candidate_users_by_identifier(
    db: &sea_orm::DatabaseConnection,
    identifier: &str,
) -> Result<Vec<CandidateUserRow>, AppError> {
    let rows = db
        .query_all(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT u.id, u.tenant_id, u.email, u.username, u.password_hash, u.role,
                      t.name AS tenant_name, t.slug AS tenant_slug
               FROM users u
               JOIN tenants t ON t.id = u.tenant_id
               WHERE (LOWER(BTRIM(u.email)) = LOWER($1) OR LOWER(BTRIM(COALESCE(u.username, ''))) = LOWER($1))
                 AND u.is_active = true
               ORDER BY t.name ASC, u.created_at ASC"#,
            [identifier.trim().to_string().into()],
        ))
        .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(CandidateUserRow {
            user_id: row.try_get("", "id")?,
            tenant_id: row.try_get("", "tenant_id")?,
            tenant_name: row.try_get("", "tenant_name")?,
            tenant_slug: row.try_get("", "tenant_slug")?,
            email: row.try_get("", "email")?,
            username: row.try_get("", "username").ok(),
            password_hash: row.try_get("", "password_hash")?,
            role: row.try_get("", "role")?,
        });
    }
    Ok(out)
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let identifier = body.email.trim();
    if identifier.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest(
            "Benutzername/E-Mail und Passwort sind erforderlich.".into(),
        ));
    }

    let candidates = query_candidate_users_by_identifier(&state.db, identifier).await?;
    if candidates.is_empty() {
        return Err(AppError::Unauthorized(
            "Ungültiger Benutzername/E-Mail oder falsches Passwort.".into(),
        ));
    }

    let argon2 = Argon2::default();
    let mut direct_verified: Vec<CandidateUserRow> = Vec::new();

    for c in candidates {
        if let Ok(parsed_hash) = PasswordHash::new(&c.password_hash) {
            if argon2
                .verify_password(body.password.as_bytes(), &parsed_hash)
                .is_ok()
            {
                direct_verified.push(c);
            }
        }
    }

    if direct_verified.is_empty() {
        return Err(AppError::Unauthorized(
            "Ungültiger Benutzername/E-Mail oder falsches Passwort.".into(),
        ));
    }

    // Also discover all active accounts sharing the same email where the same password is valid,
    // so that multi-tenant users can switch seamlessly in the UI even if they logged in by username.
    let primary_email = direct_verified[0].email.clone();
    let all_email_candidates =
        query_candidate_users_by_identifier(&state.db, &primary_email).await?;

    let mut all_verified_for_email: Vec<CandidateUserRow> = Vec::new();
    for c in all_email_candidates {
        if let Ok(parsed_hash) = PasswordHash::new(&c.password_hash) {
            if argon2
                .verify_password(body.password.as_bytes(), &parsed_hash)
                .is_ok()
            {
                all_verified_for_email.push(c);
            }
        }
    }

    // Ensure every direct match is included
    for dm in &direct_verified {
        if !all_verified_for_email.iter().any(|x| x.user_id == dm.user_id) {
            all_verified_for_email.push(dm.clone());
        }
    }

    let verified_user_ids: Vec<Uuid> = all_verified_for_email.iter().map(|r| r.user_id).collect();
    let available_tenants: Vec<TenantChoiceInfo> = all_verified_for_email
        .iter()
        .map(|r| TenantChoiceInfo {
            tenant_id: r.tenant_id,
            tenant_name: r.tenant_name.clone(),
            tenant_slug: r.tenant_slug.clone(),
            user_id: r.user_id,
            username: r.username.clone(),
            role: r.role.clone(),
        })
        .collect();

    // Determine whether a specific account is already uniquely selected:
    // 1. Explicit `tenant_id` was provided in the request
    // 2. The user logged in using their globally unique `username`
    // 3. Only one account matched `direct_verified`
    let matched_by_exact_username = direct_verified.len() == 1
        && direct_verified[0]
            .username
            .as_deref()
            .map(|u| u.trim().eq_ignore_ascii_case(identifier))
            .unwrap_or(false);

    let selected_row: Option<CandidateUserRow> = if let Some(target_tid) = body.tenant_id {
        all_verified_for_email
            .into_iter()
            .find(|r| r.tenant_id == target_tid)
            .ok_or_else(|| {
                AppError::Unauthorized("Kein Zugriff auf den gewählten Mandanten.".into())
            })
            .map(Some)?
    } else if matched_by_exact_username || direct_verified.len() == 1 {
        Some(direct_verified.into_iter().next().unwrap())
    } else {
        None
    };

    if let Some(chosen) = selected_row {
        let token = create_jwt_with_verified(
            chosen.user_id,
            chosen.tenant_id,
            &chosen.role,
            verified_user_ids,
            &state.config.jwt_secret,
        )?;

        Ok(Json(LoginResponse {
            token,
            user: Some(LoginUserInfo {
                id: chosen.user_id,
                email: chosen.email,
                username: chosen.username,
                role: chosen.role,
                tenant_id: chosen.tenant_id,
                tenant_name: chosen.tenant_name,
                tenant_slug: chosen.tenant_slug,
            }),
            requires_tenant_selection: false,
            available_tenants,
        }))
    } else {
        // Multiple tenants matched the email + password -> ask user which tenant to enter
        Ok(Json(LoginResponse {
            token: String::new(),
            user: None,
            requires_tenant_selection: true,
            available_tenants,
        }))
    }
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

    let tenant_model = tenant::Entity::find_by_id(tenant_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden".into()))?;

    let (user_model, linked_emp) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let u = user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("User not found".into()))?;

            let emp = employee::find_for_user(txn, tenant_id, &u).await?;
            Ok((u, emp))
        })
    })
    .await?;

    // Fetch all verified tenant accounts for this session so the sidebar tenant switcher stays populated
    let mut available_tenants: Vec<TenantChoiceInfo> = Vec::new();
    for v_uid in &auth_user.verified_user_ids {
        let row_opt = state
            .db
            .query_one(Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                r#"SELECT u.id, u.tenant_id, u.username, u.role,
                          t.name AS tenant_name, t.slug AS tenant_slug
                   FROM users u
                   JOIN tenants t ON t.id = u.tenant_id
                   WHERE u.id = $1 AND u.is_active = true"#,
                [(*v_uid).into()],
            ))
            .await?;

        if let Some(row) = row_opt {
            available_tenants.push(TenantChoiceInfo {
                user_id: row.try_get("", "id")?,
                tenant_id: row.try_get("", "tenant_id")?,
                tenant_name: row.try_get("", "tenant_name")?,
                tenant_slug: row.try_get("", "tenant_slug")?,
                username: row.try_get("", "username").ok(),
                role: row.try_get("", "role")?,
            });
        }
    }
    available_tenants.sort_by(|a, b| a.tenant_name.cmp(&b.tenant_name));

    Ok(Json(MeResponse {
        id: user_model.id,
        tenant_id: user_model.tenant_id,
        tenant_name: tenant_model.name,
        tenant_slug: tenant_model.slug,
        email: user_model.email,
        username: user_model.username,
        first_name: user_model.first_name,
        last_name: user_model.last_name,
        role: user_model.role,
        is_active: user_model.is_active,
        employee_id: linked_emp.map(|e| e.id),
        available_tenants,
        created_at: user_model.created_at,
        updated_at: user_model.updated_at,
    }))
}

// ---------------------------------------------------------------------------
// POST /switch-tenant
// ---------------------------------------------------------------------------

pub async fn switch_tenant(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<SwitchTenantRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let current_tenant_id = auth_user.tenant_id;
    let current_user_id = auth_user.user_id;

    let current_user = execute_with_tenant(&state.db, &current_tenant_id, |txn| {
        Box::pin(async move {
            user::Entity::find()
                .filter(user::Column::Id.eq(current_user_id))
                .filter(user::Column::TenantId.eq(current_tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Aktueller Benutzer nicht gefunden.".into()))
        })
    })
    .await?;

    // Look up the user's active account in the target tenant with the same email
    let target_row = state
        .db
        .query_one(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT u.id, u.tenant_id, u.email, u.username, u.password_hash, u.role,
                      t.name AS tenant_name, t.slug AS tenant_slug
               FROM users u
               JOIN tenants t ON t.id = u.tenant_id
               WHERE u.tenant_id = $1
                 AND LOWER(BTRIM(u.email)) = LOWER($2)
                 AND u.is_active = true
               LIMIT 1"#,
            [
                body.tenant_id.into(),
                current_user.email.trim().to_string().into(),
            ],
        ))
        .await?
        .ok_or_else(|| {
            AppError::Forbidden(
                "Für Ihre E-Mail-Adresse existiert kein aktives Konto im Ziel-Mandanten.".into(),
            )
        })?;

    let target_user_id: Uuid = target_row.try_get("", "id")?;
    let target_tenant_id: Uuid = target_row.try_get("", "tenant_id")?;
    let target_email: String = target_row.try_get("", "email")?;
    let target_username: Option<String> = target_row.try_get("", "username").ok();
    let target_hash: String = target_row.try_get("", "password_hash")?;
    let target_role: String = target_row.try_get("", "role")?;
    let target_tenant_name: String = target_row.try_get("", "tenant_name")?;
    let target_tenant_slug: String = target_row.try_get("", "tenant_slug")?;

    let mut verified_ids = auth_user.verified_user_ids.clone();

    if !verified_ids.contains(&target_user_id) {
        let pw = body.password.as_deref().unwrap_or("");
        if pw.is_empty() {
            return Err(AppError::Unauthorized(
                "Bitte geben Sie das Passwort für diesen Mandanten ein.".into(),
            ));
        }
        let parsed = PasswordHash::new(&target_hash)
            .map_err(|e| AppError::InternalError(format!("Failed to parse hash: {e}")))?;
        Argon2::default()
            .verify_password(pw.as_bytes(), &parsed)
            .map_err(|_| AppError::Unauthorized("Falsches Passwort für den Ziel-Mandanten.".into()))?;

        verified_ids.push(target_user_id);
    }

    let token = create_jwt_with_verified(
        target_user_id,
        target_tenant_id,
        &target_role,
        verified_ids.clone(),
        &state.config.jwt_secret,
    )?;

    Ok(Json(LoginResponse {
        token,
        user: Some(LoginUserInfo {
            id: target_user_id,
            email: target_email,
            username: target_username,
            role: target_role,
            tenant_id: target_tenant_id,
            tenant_name: target_tenant_name,
            tenant_slug: target_tenant_slug,
        }),
        requires_tenant_selection: false,
        available_tenants: vec![],
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
