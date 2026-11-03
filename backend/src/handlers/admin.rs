use axum::{
    extract::{Path, State},
    routing::{get, post, put},
    Json, Router,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHasher,
};

use crate::AppState;
use crate::errors::AppError;
use crate::handlers::auth::{LoginResponse, LoginUserInfo};
use crate::middleware::auth::{create_jwt_with_verified, AuthUser};
use crate::middleware::tenant::{execute_with_tenant, set_tenant_context};
use crate::models::{employee, shift_type, tenant, user};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct TenantUserAdminInfo {
    pub id: Uuid,
    pub email: String,
    pub username: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub is_active: bool,
    pub linked_employee_id: Option<Uuid>,
    pub linked_employee_name: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Debug, Serialize)]
pub struct TenantAdminResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub max_employees: Option<u64>,
    pub is_suspended: bool,
    pub suspension_reason: Option<String>,
    pub license_note: Option<String>,
    pub license_expires_at: Option<String>,
    pub active_employees_count: u64,
    pub total_employees_count: u64,
    pub users_count: u64,
    pub shift_types_count: u64,
    pub admins: Vec<TenantUserAdminInfo>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
    pub slug: String,
    pub max_employees: Option<u64>,
    pub license_note: Option<String>,
    pub license_expires_at: Option<String>,
    pub manager_email: String,
    pub manager_username: Option<String>,
    pub manager_password: String,
    pub manager_first_name: String,
    pub manager_last_name: String,
    pub create_manager_employee: Option<bool>,
    pub manager_weekly_hours: Option<f32>,
    pub manager_vacation_days: Option<i32>,
    pub seed_default_shifts: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenantRequest {
    pub name: String,
    pub slug: String,
    pub max_employees: Option<u64>,
    pub is_suspended: Option<bool>,
    pub suspension_reason: Option<String>,
    pub license_note: Option<String>,
    pub license_expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTenantUserRequest {
    pub email: String,
    pub username: Option<String>,
    pub password: String,
    pub first_name: String,
    pub last_name: String,
    pub role: Option<String>,
    pub create_employee_profile: Option<bool>,
    pub weekly_hours: Option<f32>,
    pub vacation_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenantUserRequest {
    pub email: Option<String>,
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub password: Option<String>,
    pub ensure_employee_profile: Option<bool>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_super_admin(auth: &AuthUser) -> Result<(), AppError> {
    if auth.role != "super_admin" {
        return Err(AppError::Forbidden("Super-Admin-Rechte erforderlich".to_string()));
    }
    Ok(())
}

async fn build_tenant_admin_response(
    db: &sea_orm::DatabaseConnection,
    t: tenant::Model,
) -> Result<TenantAdminResponse, AppError> {
    let tid = t.id;
    let max_employees = t.settings.get("max_employees").and_then(|v| v.as_u64());
    let is_suspended = t
        .settings
        .get("is_suspended")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let suspension_reason = t
        .settings
        .get("suspension_reason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());
    let license_note = t
        .settings
        .get("license_note")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());
    let license_expires_at = t
        .settings
        .get("license_expires_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    let (active_emp_count, total_emp_count, users_count, shift_types_count, admins) =
        execute_with_tenant(db, &tid, |txn| {
            Box::pin(async move {
                let active_emps = employee::Entity::find()
                    .filter(employee::Column::TenantId.eq(tid))
                    .filter(employee::Column::IsActive.eq(true))
                    .count(txn)
                    .await?;
                let all_emps = employee::Entity::find()
                    .filter(employee::Column::TenantId.eq(tid))
                    .all(txn)
                    .await?;
                let total_emps = all_emps.len() as u64;

                let all_users = user::Entity::find()
                    .filter(user::Column::TenantId.eq(tid))
                    .order_by_asc(user::Column::CreatedAt)
                    .all(txn)
                    .await?;
                let u_count = all_users.len() as u64;

                let st_count = shift_type::Entity::find()
                    .filter(shift_type::Column::TenantId.eq(tid))
                    .filter(shift_type::Column::IsActive.eq(true))
                    .count(txn)
                    .await?;

                let mut admin_list = Vec::new();
                for u in all_users {
                    if u.role == "admin" || u.role == "super_admin" {
                        let linked_emp = all_emps.iter().find(|e| {
                            e.user_id == Some(u.id)
                                || (e.user_id.is_none()
                                    && e.email
                                        .as_deref()
                                        .map(|em| em.trim().eq_ignore_ascii_case(u.email.trim()))
                                        .unwrap_or(false))
                        });
                        admin_list.push(TenantUserAdminInfo {
                            id: u.id,
                            email: u.email,
                            username: u.username,
                            first_name: u.first_name,
                            last_name: u.last_name,
                            role: u.role,
                            is_active: u.is_active,
                            linked_employee_id: linked_emp.map(|e| e.id),
                            linked_employee_name: linked_emp.map(|e| {
                                format!(
                                    "{} {}",
                                    e.first_name.as_deref().unwrap_or(""),
                                    e.last_name.as_deref().unwrap_or("")
                                )
                                .trim()
                                .to_string()
                            }),
                            created_at: u.created_at,
                        });
                    }
                }

                Ok((active_emps, total_emps, u_count, st_count, admin_list))
            })
        })
        .await?;

    Ok(TenantAdminResponse {
        id: t.id,
        name: t.name,
        slug: t.slug,
        max_employees,
        is_suspended,
        suspension_reason,
        license_note,
        license_expires_at,
        active_employees_count: active_emp_count,
        total_employees_count: total_emp_count,
        users_count,
        shift_types_count,
        admins,
        created_at: t.created_at,
        updated_at: t.updated_at,
    })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenants", get(list_tenants).post(create_tenant))
        .route("/tenants/{id}", put(update_tenant).delete(delete_tenant))
        .route(
            "/tenants/{id}/users",
            get(list_tenant_users).post(create_tenant_user),
        )
        .route(
            "/tenants/{id}/users/{user_id}",
            put(update_tenant_user).delete(delete_tenant_user),
        )
        .route("/tenants/{id}/impersonate", post(impersonate_tenant))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/admin/tenants – List all tenants with live statistics and admin accounts
pub async fn list_tenants(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<TenantAdminResponse>>, AppError> {
    require_super_admin(&auth)?;

    let tenants = tenant::Entity::find()
        .order_by_asc(tenant::Column::Name)
        .all(&state.db)
        .await?;

    let mut res = Vec::with_capacity(tenants.len());
    for t in tenants {
        res.push(build_tenant_admin_response(&state.db, t).await?);
    }

    Ok(Json(res))
}

/// POST /api/admin/tenants – Create tenant + manager + optional employee profile & default shifts
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
    let manager_user_id = Uuid::new_v4();
    let now = chrono::Utc::now().fixed_offset();

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(payload.manager_password.as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
        .to_string();

    let settings = serde_json::json!({
        "max_employees": payload.max_employees,
        "is_suspended": false,
        "license_note": payload.license_note.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        "license_expires_at": payload.license_expires_at.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    });

    let txn = state.db.begin().await?;

    let existing_slug = tenant::Entity::find()
        .filter(tenant::Column::Slug.eq(payload.slug.trim()))
        .one(&txn)
        .await?;
    if existing_slug.is_some() {
        return Err(AppError::Conflict(
            "Ein Betrieb mit diesem Slug existiert bereits.".to_string(),
        ));
    }

    let manager_username = if let Some(ref raw_uname) = payload
        .manager_username
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        let validated = user::validate_username_format(raw_uname)?;
        if user::is_username_taken(&txn, &validated, None).await? {
            return Err(AppError::Conflict(
                "Dieser Benutzername ist bereits vergeben.".to_string(),
            ));
        }
        validated
    } else {
        user::generate_unique_username(&txn, payload.manager_email.trim(), payload.slug.trim(), None)
            .await?
    };

    let new_tenant = tenant::Model {
        id: tenant_id,
        name: payload.name.trim().to_string(),
        slug: payload.slug.trim().to_string(),
        settings,
        created_at: now,
        updated_at: now,
    };
    let active_tenant: tenant::ActiveModel = new_tenant.clone().into();
    let inserted_tenant = active_tenant.insert(&txn).await?;

    set_tenant_context(&txn, &tenant_id).await?;

    let clean_email = payload.manager_email.trim().to_string();
    let first_name = payload.manager_first_name.trim().to_string();
    let last_name = payload.manager_last_name.trim().to_string();

    let new_manager = user::ActiveModel {
        id: Set(manager_user_id),
        tenant_id: Set(tenant_id),
        email: Set(clean_email.clone()),
        username: Set(Some(manager_username)),
        password_hash: Set(password_hash),
        first_name: Set(first_name.clone()),
        last_name: Set(last_name.clone()),
        role: Set("admin".to_string()),
        is_active: Set(true),
        created_at: Set(now),
        updated_at: Set(now),
    };
    new_manager.insert(&txn).await?;

    if payload.create_manager_employee.unwrap_or(false) {
        let vac_days = payload.manager_vacation_days.unwrap_or(30);
        let weekly_hours = payload.manager_weekly_hours.unwrap_or(40.0);
        let emp_active = employee::ActiveModel {
            id: Set(Uuid::new_v4()),
            tenant_id: Set(tenant_id),
            user_id: Set(Some(manager_user_id)),
            first_name: Set(Some(if first_name.is_empty() {
                "Betriebsleiter".to_string()
            } else {
                first_name
            })),
            last_name: Set(Some(last_name)),
            email: Set(Some(clean_email)),
            phone: Set(None),
            weekly_hours: Set(weekly_hours),
            monthly_hours: Set(None),
            yearly_hours: Set(None),
            vacation_days_per_year: Set(vac_days),
            vacation_days_remaining: Set(vac_days as f32),
            shift_preferences: Set(serde_json::json!({})),
            is_active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        };
        emp_active.insert(&txn).await?;
    }

    if payload.seed_default_shifts.unwrap_or(true) {
        let defaults = [
            ("Frühschicht", "06:00:00", "14:00:00", 30, "#3b82f6"),
            ("Spätschicht", "14:00:00", "22:00:00", 30, "#f59e0b"),
            ("Tagdienst", "08:00:00", "16:30:00", 30, "#10b981"),
        ];
        for (st_name, start_s, end_s, brk, color) in defaults {
            let st_active = shift_type::ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                name: Set(st_name.to_string()),
                start_time: Set(chrono::NaiveTime::parse_from_str(start_s, "%H:%M:%S").unwrap()),
                end_time: Set(chrono::NaiveTime::parse_from_str(end_s, "%H:%M:%S").unwrap()),
                break_minutes: Set(brk),
                color: Set(color.to_string()),
                is_active: Set(true),
                valid_days: Set(serde_json::json!([1, 2, 3, 4, 5])),
                min_staff: Set(Some(1)),
                max_staff: Set(Some(3)),
                holiday_mode: Set("exclude".to_string()),
                created_at: Set(now),
                updated_at: Set(now),
            };
            st_active.insert(&txn).await?;
        }
    }

    txn.commit().await?;

    let full_res = build_tenant_admin_response(&state.db, inserted_tenant).await?;
    Ok(Json(full_res))
}

/// PUT /api/admin/tenants/{id} – Update tenant details, suspension status, and license info
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

    let slug_collision = tenant::Entity::find()
        .filter(tenant::Column::Slug.eq(payload.slug.trim()))
        .filter(tenant::Column::Id.ne(id))
        .one(&state.db)
        .await?;
    if slug_collision.is_some() {
        return Err(AppError::Conflict(
            "Ein anderer Betrieb verwendet bereits diesen Slug.".to_string(),
        ));
    }

    if id == auth.tenant_id && payload.is_suspended == Some(true) {
        return Err(AppError::BadRequest(
            "Der eigene System-Mandant des Super-Admins kann nicht gesperrt werden.".to_string(),
        ));
    }

    let mut settings = existing.settings.clone();
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    settings["max_employees"] = serde_json::json!(payload.max_employees);

    if let Some(susp) = payload.is_suspended {
        settings["is_suspended"] = serde_json::json!(susp);
    }
    if let Some(ref reason) = payload.suspension_reason {
        let trimmed = reason.trim();
        if trimmed.is_empty() {
            if let Some(obj) = settings.as_object_mut() {
                obj.remove("suspension_reason");
            }
        } else {
            settings["suspension_reason"] = serde_json::json!(trimmed);
        }
    }
    if let Some(ref note) = payload.license_note {
        let trimmed = note.trim();
        if trimmed.is_empty() {
            if let Some(obj) = settings.as_object_mut() {
                obj.remove("license_note");
            }
        } else {
            settings["license_note"] = serde_json::json!(trimmed);
        }
    }
    if let Some(ref exp) = payload.license_expires_at {
        let trimmed = exp.trim();
        if trimmed.is_empty() {
            if let Some(obj) = settings.as_object_mut() {
                obj.remove("license_expires_at");
            }
        } else {
            settings["license_expires_at"] = serde_json::json!(trimmed);
        }
    }

    let mut active: tenant::ActiveModel = existing.into();
    active.name = Set(payload.name.trim().to_string());
    active.slug = Set(payload.slug.trim().to_string());
    active.settings = Set(settings);
    active.updated_at = Set(chrono::Utc::now().fixed_offset());

    let updated = active.update(&state.db).await?;
    let full_res = build_tenant_admin_response(&state.db, updated).await?;

    Ok(Json(full_res))
}

/// DELETE /api/admin/tenants/{id} – Delete tenant
pub async fn delete_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_super_admin(&auth)?;

    if id == auth.tenant_id {
        return Err(AppError::BadRequest(
            "Der eigene System-Mandant des Super-Admins kann nicht gelöscht werden.".to_string(),
        ));
    }

    let result = tenant::Entity::delete_by_id(id)
        .exec(&state.db)
        .await?;

    if result.rows_affected == 0 {
        return Err(AppError::NotFound("Betrieb nicht gefunden".to_string()));
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

/// GET /api/admin/tenants/{id}/users – List all users in a tenant
pub async fn list_tenant_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(tenant_id): Path<Uuid>,
) -> Result<Json<Vec<TenantUserAdminInfo>>, AppError> {
    require_super_admin(&auth)?;

    let users = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let all_users = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .order_by_asc(user::Column::CreatedAt)
                .all(txn)
                .await?;

            let all_emps = employee::Entity::find()
                .filter(employee::Column::TenantId.eq(tenant_id))
                .all(txn)
                .await?;

            let out: Vec<TenantUserAdminInfo> = all_users
                .into_iter()
                .map(|u| {
                    let linked_emp = all_emps.iter().find(|e| {
                        e.user_id == Some(u.id)
                            || (e.user_id.is_none()
                                && e.email
                                    .as_deref()
                                    .map(|em| em.trim().eq_ignore_ascii_case(u.email.trim()))
                                    .unwrap_or(false))
                    });
                    TenantUserAdminInfo {
                        id: u.id,
                        email: u.email,
                        username: u.username,
                        first_name: u.first_name,
                        last_name: u.last_name,
                        role: u.role,
                        is_active: u.is_active,
                        linked_employee_id: linked_emp.map(|e| e.id),
                        linked_employee_name: linked_emp.map(|e| {
                            format!(
                                "{} {}",
                                e.first_name.as_deref().unwrap_or(""),
                                e.last_name.as_deref().unwrap_or("")
                            )
                            .trim()
                            .to_string()
                        }),
                        created_at: u.created_at,
                    }
                })
                .collect();

            Ok(out)
        })
    })
    .await?;

    Ok(Json(users))
}

/// POST /api/admin/tenants/{id}/users – Create a user account in a tenant (e.g. new admin/planner)
pub async fn create_tenant_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(tenant_id): Path<Uuid>,
    Json(payload): Json<CreateTenantUserRequest>,
) -> Result<Json<TenantUserAdminInfo>, AppError> {
    require_super_admin(&auth)?;

    if payload.email.trim().is_empty() || payload.password.trim().is_empty() {
        return Err(AppError::BadRequest(
            "E-Mail und Passwort sind erforderlich.".to_string(),
        ));
    }
    if payload.password.trim().len() < 6 {
        return Err(AppError::BadRequest(
            "Das Passwort muss mindestens 6 Zeichen lang sein.".to_string(),
        ));
    }

    let role = payload.role.unwrap_or_else(|| "admin".to_string());
    if !["admin", "planner", "viewer"].contains(&role.as_str()) {
        return Err(AppError::BadRequest(
            "Ungültige Rolle. Erlaubt: admin, planner, viewer".to_string(),
        ));
    }

    let tenant_model = tenant::Entity::find_by_id(tenant_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden.".to_string()))?;

    let final_username = if let Some(ref raw_u) = payload
        .username
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        let validated = user::validate_username_format(raw_u)?;
        if user::is_username_taken(&state.db, &validated, None).await? {
            return Err(AppError::Conflict(
                "Dieser Benutzername ist bereits vergeben.".to_string(),
            ));
        }
        validated
    } else {
        user::generate_unique_username(&state.db, payload.email.trim(), &tenant_model.slug, None)
            .await?
    };

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(payload.password.trim().as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
        .to_string();

    let now = chrono::Utc::now().fixed_offset();
    let clean_email = payload.email.trim().to_string();
    let first_name = payload.first_name.trim().to_string();
    let last_name = payload.last_name.trim().to_string();
    let create_emp = payload.create_employee_profile.unwrap_or(false);
    let weekly_hours = payload.weekly_hours.unwrap_or(40.0);
    let vac_days = payload.vacation_days.unwrap_or(30);

    let created_info = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing_users = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .all(txn)
                .await?;
            if existing_users
                .iter()
                .any(|u| u.email.trim().eq_ignore_ascii_case(&clean_email))
            {
                return Err(AppError::Conflict(
                    "In diesem Mandanten existiert bereits ein Benutzer mit dieser E-Mail-Adresse."
                        .to_string(),
                ));
            }

            let new_uid = Uuid::new_v4();
            let new_u = user::ActiveModel {
                id: Set(new_uid),
                tenant_id: Set(tenant_id),
                email: Set(clean_email.clone()),
                username: Set(Some(final_username)),
                password_hash: Set(password_hash),
                first_name: Set(first_name.clone()),
                last_name: Set(last_name.clone()),
                role: Set(role),
                is_active: Set(true),
                created_at: Set(now),
                updated_at: Set(now),
            };
            let inserted = new_u.insert(txn).await?;

            let mut linked_emp_id = None;
            let mut linked_emp_name = None;

            if create_emp {
                let emp_first = if first_name.is_empty() {
                    "Mitarbeiter".to_string()
                } else {
                    first_name
                };
                let emp_full = format!("{} {}", emp_first, last_name).trim().to_string();
                let emp_id = Uuid::new_v4();
                let emp_active = employee::ActiveModel {
                    id: Set(emp_id),
                    tenant_id: Set(tenant_id),
                    user_id: Set(Some(new_uid)),
                    first_name: Set(Some(emp_first)),
                    last_name: Set(Some(last_name)),
                    email: Set(Some(clean_email)),
                    phone: Set(None),
                    weekly_hours: Set(weekly_hours),
                    monthly_hours: Set(None),
                    yearly_hours: Set(None),
                    vacation_days_per_year: Set(vac_days),
                    vacation_days_remaining: Set(vac_days as f32),
                    shift_preferences: Set(serde_json::json!({})),
                    is_active: Set(true),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                emp_active.insert(txn).await?;
                linked_emp_id = Some(emp_id);
                linked_emp_name = Some(emp_full);
            }

            Ok(TenantUserAdminInfo {
                id: inserted.id,
                email: inserted.email,
                username: inserted.username,
                first_name: inserted.first_name,
                last_name: inserted.last_name,
                role: inserted.role,
                is_active: inserted.is_active,
                linked_employee_id: linked_emp_id,
                linked_employee_name: linked_emp_name,
                created_at: inserted.created_at,
            })
        })
    })
    .await?;

    Ok(Json(created_info))
}

/// PUT /api/admin/tenants/{id}/users/{user_id} – Update user credentials/role/status or create linked employee profile
pub async fn update_tenant_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((tenant_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateTenantUserRequest>,
) -> Result<Json<TenantUserAdminInfo>, AppError> {
    require_super_admin(&auth)?;

    let validated_uname = if let Some(ref raw_u) = payload
        .username
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        let v = user::validate_username_format(raw_u)?;
        if user::is_username_taken(&state.db, &v, Some(user_id)).await? {
            return Err(AppError::Conflict(
                "Dieser Benutzername ist bereits vergeben.".to_string(),
            ));
        }
        Some(v)
    } else {
        None
    };

    let now = chrono::Utc::now().fixed_offset();

    let updated_info = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let existing = user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Benutzer im Mandanten nicht gefunden.".to_string()))?;

            let mut active_u: user::ActiveModel = existing.clone().into();

            if let Some(ref new_email) = payload.email {
                let clean = new_email.trim();
                if !clean.is_empty() && !clean.eq_ignore_ascii_case(existing.email.trim()) {
                    let all_u = user::Entity::find()
                        .filter(user::Column::TenantId.eq(tenant_id))
                        .all(txn)
                        .await?;
                    if all_u
                        .iter()
                        .any(|u| u.id != user_id && u.email.trim().eq_ignore_ascii_case(clean))
                    {
                        return Err(AppError::Conflict(
                            "Diese E-Mail-Adresse wird im Mandanten bereits verwendet.".to_string(),
                        ));
                    }
                    active_u.email = Set(clean.to_string());
                }
            }

            if let Some(u_name) = validated_uname {
                active_u.username = Set(Some(u_name));
            }
            if let Some(first) = payload.first_name {
                active_u.first_name = Set(first.trim().to_string());
            }
            if let Some(last) = payload.last_name {
                active_u.last_name = Set(last.trim().to_string());
            }
            if let Some(role) = payload.role {
                if existing.role != "super_admin" {
                    if !["admin", "planner", "viewer"].contains(&role.as_str()) {
                        return Err(AppError::BadRequest("Ungültige Rolle.".to_string()));
                    }
                    active_u.role = Set(role);
                }
            }
            if let Some(act) = payload.is_active {
                if user_id == auth.user_id && !act {
                    return Err(AppError::BadRequest(
                        "Sie können Ihr eigenes Super-Admin-Konto nicht deaktivieren.".to_string(),
                    ));
                }
                active_u.is_active = Set(act);
            }
            if let Some(new_pw) = payload.password.filter(|p| !p.trim().is_empty()) {
                if new_pw.trim().len() < 6 {
                    return Err(AppError::BadRequest(
                        "Das neue Passwort muss mindestens 6 Zeichen lang sein.".to_string(),
                    ));
                }
                let salt = SaltString::generate(&mut OsRng);
                let hash = Argon2::default()
                    .hash_password(new_pw.trim().as_bytes(), &salt)
                    .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
                    .to_string();
                active_u.password_hash = Set(hash);
            }

            active_u.updated_at = Set(now);
            let updated = active_u.update(txn).await?;

            let mut linked_emp = employee::find_for_user(txn, tenant_id, &updated).await?;

            if payload.ensure_employee_profile == Some(true) && linked_emp.is_none() {
                let first = if updated.first_name.trim().is_empty() {
                    "Betriebsleiter".to_string()
                } else {
                    updated.first_name.clone()
                };
                let new_emp = employee::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    tenant_id: Set(tenant_id),
                    user_id: Set(Some(updated.id)),
                    first_name: Set(Some(first)),
                    last_name: Set(Some(updated.last_name.clone())),
                    email: Set(Some(updated.email.clone())),
                    phone: Set(None),
                    weekly_hours: Set(40.0),
                    monthly_hours: Set(None),
                    yearly_hours: Set(None),
                    vacation_days_per_year: Set(30),
                    vacation_days_remaining: Set(30.0),
                    shift_preferences: Set(serde_json::json!({})),
                    is_active: Set(true),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                linked_emp = Some(new_emp.insert(txn).await?);
            } else if let Some(ref emp) = linked_emp {
                if emp.user_id != Some(updated.id) {
                    let mut active_emp: employee::ActiveModel = emp.clone().into();
                    active_emp.user_id = Set(Some(updated.id));
                    active_emp.updated_at = Set(now);
                    linked_emp = Some(active_emp.update(txn).await?);
                }
            }

            Ok(TenantUserAdminInfo {
                id: updated.id,
                email: updated.email,
                username: updated.username,
                first_name: updated.first_name,
                last_name: updated.last_name,
                role: updated.role,
                is_active: updated.is_active,
                linked_employee_id: linked_emp.as_ref().map(|e| e.id),
                linked_employee_name: linked_emp.map(|e| {
                    format!(
                        "{} {}",
                        e.first_name.as_deref().unwrap_or(""),
                        e.last_name.as_deref().unwrap_or("")
                    )
                    .trim()
                    .to_string()
                }),
                created_at: updated.created_at,
            })
        })
    })
    .await?;

    Ok(Json(updated_info))
}

/// DELETE /api/admin/tenants/{id}/users/{user_id} – Delete a user account in a tenant
pub async fn delete_tenant_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((tenant_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_super_admin(&auth)?;

    if user_id == auth.user_id {
        return Err(AppError::BadRequest(
            "Sie können Ihr eigenes Super-Admin-Konto nicht löschen.".to_string(),
        ));
    }

    execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let res = user::Entity::delete_many()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;
            if res.rows_affected == 0 {
                return Err(AppError::NotFound("Benutzer nicht gefunden.".to_string()));
            }
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// POST /api/admin/tenants/{id}/impersonate – 1-click Support Login into a tenant as its admin
pub async fn impersonate_tenant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(tenant_id): Path<Uuid>,
) -> Result<Json<LoginResponse>, AppError> {
    require_super_admin(&auth)?;

    let tenant_model = tenant::Entity::find_by_id(tenant_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden.".to_string()))?;

    let target_user = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let all_users = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .filter(user::Column::IsActive.eq(true))
                .order_by_asc(user::Column::CreatedAt)
                .all(txn)
                .await?;

            // Prefer an admin account, otherwise planner, otherwise any active user
            let chosen = all_users
                .iter()
                .find(|u| u.role == "admin" || u.role == "super_admin")
                .or_else(|| all_users.iter().find(|u| u.role == "planner"))
                .or_else(|| all_users.first())
                .cloned()
                .ok_or_else(|| {
                    AppError::BadRequest(
                        "In diesem Mandanten existiert kein aktives Benutzerkonto für den Support-Login."
                            .to_string(),
                    )
                })?;

            Ok(chosen)
        })
    })
    .await?;

    let mut verified_ids = auth.verified_user_ids.clone();
    if !verified_ids.contains(&auth.user_id) {
        verified_ids.push(auth.user_id);
    }
    if !verified_ids.contains(&target_user.id) {
        verified_ids.push(target_user.id);
    }

    let token = create_jwt_with_verified(
        target_user.id,
        tenant_id,
        &target_user.role,
        verified_ids,
        &state.config.jwt_secret,
    )?;

    Ok(Json(LoginResponse {
        token,
        user: Some(LoginUserInfo {
            id: target_user.id,
            email: target_user.email,
            username: target_user.username,
            role: target_user.role,
            tenant_id,
            tenant_name: tenant_model.name,
            tenant_slug: tenant_model.slug,
        }),
        requires_tenant_selection: false,
        available_tenants: vec![],
    }))
}
