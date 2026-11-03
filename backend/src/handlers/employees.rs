use axum::{
    extract::{Path, Query, State},
    routing::{get, post, put, delete},
    Json, Router,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::employee::{ActiveModel, Column, Entity as Employee};
use crate::models::{tenant, user};
use crate::AppState;

use super::{blocked_days, vacations};

// ---------------------------------------------------------------------------
// Query / Response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListQuery {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
    pub is_active: Option<bool>,
}

#[derive(Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: u64,
    pub page: u64,
    pub per_page: u64,
}

#[derive(Deserialize)]
pub struct CreateEmployeeRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub weekly_hours: Option<f32>,
    pub monthly_hours: Option<f32>,
    pub yearly_hours: Option<f32>,
    pub vacation_days_per_year: Option<i32>,
    pub vacation_days_remaining: Option<f32>,
    pub shift_preferences: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct UpdateEmployeeRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub weekly_hours: Option<f32>,
    pub monthly_hours: Option<f32>,
    pub yearly_hours: Option<f32>,
    pub vacation_days_per_year: Option<i32>,
    pub vacation_days_remaining: Option<f32>,
    pub shift_preferences: Option<serde_json::Value>,
    pub is_active: Option<bool>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn require_manager(auth: &AuthUser) -> Result<(), AppError> {
    match auth.role.as_str() {
        "super_admin" | "admin" | "planner" => Ok(()),
        _ => Err(AppError::Forbidden("Manager access required".to_string())),
    }
}

fn require_admin(auth: &AuthUser) -> Result<(), AppError> {
    match auth.role.as_str() {
        "super_admin" | "admin" => Ok(()),
        _ => Err(AppError::Forbidden("Administrator access required".to_string())),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_employees).post(create_employee))
        .route("/me", get(get_current_employee))
        .route("/me/preferences", put(update_my_preferences))
        .route("/{id}", get(get_employee).put(update_employee).delete(delete_employee))
        .route("/{id}/create-user", post(create_employee_user))
        .route("/{id}/user-account", get(get_employee_user_account).put(update_employee_user_account))
        
        .route("/{employee_id}/blocked-days", get(blocked_days::list_blocked_days).post(blocked_days::create_blocked_day))
        .route("/{employee_id}/blocked-days/", get(blocked_days::list_blocked_days).post(blocked_days::create_blocked_day))
        .route("/{employee_id}/blocked-days/{id}", delete(blocked_days::delete_blocked_day))
        
        .route("/{employee_id}/vacations", get(vacations::list_vacations).post(vacations::create_vacation))
        .route("/{employee_id}/vacations/", get(vacations::list_vacations).post(vacations::create_vacation))
        .route("/{employee_id}/vacations/{id}", delete(vacations::delete_vacation))
        .route("/{employee_id}/vacations/{id}/approve", put(vacations::approve_vacation))
        .route("/{employee_id}/vacations/{id}/reject", put(vacations::reject_vacation))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET / – list employees with optional `is_active` filter and pagination.
async fn list_employees(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<PaginatedResponse<serde_json::Value>>, AppError> {
    let tenant_id = auth.tenant_id;
    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(50).max(1);
    let is_active_filter = query.is_active;

    let result = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let mut query = Employee::find()
                .filter(Column::TenantId.eq(tenant_id))
                .order_by_asc(Column::LastName);

            if let Some(active) = is_active_filter {
                query = query.filter(Column::IsActive.eq(active));
            }

            let paginator = query.paginate(txn, per_page);
            let total = paginator.num_items().await?;
            let models = paginator.fetch_page(page - 1).await?;

            let data: Vec<serde_json::Value> = models
                .into_iter()
                .map(|m| serde_json::to_value(m).unwrap())
                .collect();

            Ok((data, total))
        })
    })
    .await?;

    let (data, total) = result;

    Ok(Json(PaginatedResponse {
        data,
        total,
        page,
        per_page,
    }))
}

/// GET /:id – get a single employee by ID.
/// Managers can view any employee in their tenant; viewers can only view their own profile.
async fn get_employee(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;
    let user_id = auth.user_id;
    let role = auth.role.clone();

    let model = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            if !matches!(role.as_str(), "super_admin" | "admin" | "planner") {
                let current_user = user::Entity::find()
                    .filter(user::Column::Id.eq(user_id))
                    .filter(user::Column::TenantId.eq(tenant_id))
                    .one(txn)
                    .await?
                    .ok_or_else(|| AppError::Forbidden("Kein Zugriff.".to_string()))?;

                let is_own_profile = emp
                    .email
                    .as_deref()
                    .map(|em| !em.trim().is_empty() && em.trim().eq_ignore_ascii_case(current_user.email.trim()))
                    .unwrap_or(false);

                if !is_own_profile {
                    return Err(AppError::Forbidden(
                        "Sie haben nur Zugriff auf Ihr eigenes Mitarbeiterprofil.".to_string(),
                    ));
                }
            }

            Ok(emp)
        })
    })
    .await?;

    let value = serde_json::to_value(model)
        .map_err(|e| AppError::InternalError(format!("Serialization error: {e}")))?;

    Ok(Json(value))
}

/// POST / – create a new employee. Requires manager+ role.
async fn create_employee(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateEmployeeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let now = chrono::Utc::now().fixed_offset();
    let tenant_id = auth.tenant_id;

    // Fetch tenant to check employee limit
    let tenant = tenant::Entity::find_by_id(tenant_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden".to_string()))?;

    let max_employees = tenant.settings
        .get("max_employees")
        .and_then(|v| v.as_u64());

    if let Some(limit) = max_employees {
        let count = execute_with_tenant(&state.db, &tenant_id, |txn| {
            Box::pin(async move {
                Employee::find()
                    .filter(Column::TenantId.eq(tenant_id))
                    .filter(Column::IsActive.eq(true))
                    .count(txn)
                    .await
                    .map_err(Into::into)
            })
        })
        .await?;

        if count >= limit {
            return Err(AppError::BadRequest(format!(
                "Mitarbeiterlimit von {} für diesen Mandanten erreicht.",
                limit
            )));
        }
    }

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let vac_per_year = body.vacation_days_per_year.unwrap_or(30);
            let vac_remaining = body.vacation_days_remaining.unwrap_or(vac_per_year as f32);
            let active_model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                first_name: Set(body.first_name),
                last_name: Set(body.last_name),
                email: Set(body.email),
                phone: Set(body.phone),
                weekly_hours: Set(body.weekly_hours.unwrap_or(40.0)),
                monthly_hours: Set(body.monthly_hours),
                yearly_hours: Set(body.yearly_hours),
                vacation_days_per_year: Set(vac_per_year),
                vacation_days_remaining: Set(vac_remaining),
                shift_preferences: Set(body.shift_preferences.unwrap_or_else(|| serde_json::json!({}))),
                is_active: Set(true),
                created_at: Set(now),
                updated_at: Set(now),
            };

            let model = active_model.insert(txn).await?;
            Ok(model)
        })
    })
    .await?;

    let value = serde_json::to_value(model)
        .map_err(|e| AppError::InternalError(format!("Serialization error: {e}")))?;

    Ok(Json(value))
}

/// PUT /:id – update an existing employee. Requires manager+ role.
async fn update_employee(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateEmployeeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let now = chrono::Utc::now().fixed_offset();
    let tenant_id = auth.tenant_id;

    // Enforce employee limit if activating an employee
    if let Some(true) = body.is_active {
        let tenant = tenant::Entity::find_by_id(tenant_id)
            .one(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden".to_string()))?;

        let max_employees = tenant.settings
            .get("max_employees")
            .and_then(|v| v.as_u64());

        if let Some(limit) = max_employees {
            let count = execute_with_tenant(&state.db, &tenant_id, |txn| {
                Box::pin(async move {
                    Employee::find()
                        .filter(Column::TenantId.eq(tenant_id))
                        .filter(Column::IsActive.eq(true))
                        .count(txn)
                        .await
                        .map_err(Into::into)
                })
            })
            .await?;

            let is_currently_active = execute_with_tenant(&state.db, &tenant_id, |txn| {
                Box::pin(async move {
                    let emp = Employee::find()
                        .filter(Column::Id.eq(id))
                        .filter(Column::TenantId.eq(tenant_id))
                        .one(txn)
                        .await?
                        .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;
                    Ok(emp.is_active)
                })
            })
            .await?;

            if !is_currently_active && count >= limit {
                return Err(AppError::BadRequest(format!(
                    "Mitarbeiterlimit von {} für diesen Mandanten erreicht.",
                    limit
                )));
            }
        }
    }

    let model = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let existing = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            let old_email = existing.email.clone();
            let old_vac_per_year = existing.vacation_days_per_year;
            let old_vac_remaining = existing.vacation_days_remaining;
            let mut active_model: ActiveModel = existing.into();

            if let Some(ref v) = body.first_name {
                active_model.first_name = Set(Some(v.clone()));
            }
            if let Some(ref v) = body.last_name {
                active_model.last_name = Set(Some(v.clone()));
            }
            if let Some(ref v) = body.email {
                active_model.email = Set(Some(v.clone()));
            }
            if let Some(v) = body.phone {
                active_model.phone = Set(Some(v));
            }
            if let Some(v) = body.weekly_hours {
                active_model.weekly_hours = Set(v);
            }
            if let Some(v) = body.monthly_hours {
                active_model.monthly_hours = Set(Some(v));
            }
            if let Some(v) = body.yearly_hours {
                active_model.yearly_hours = Set(Some(v));
            }
            if let Some(v) = body.vacation_days_per_year {
                active_model.vacation_days_per_year = Set(v);
                if body.vacation_days_remaining.is_none() {
                    let delta = (v - old_vac_per_year) as f32;
                    active_model.vacation_days_remaining = Set((old_vac_remaining + delta).max(0.0));
                }
            }
            if let Some(v) = body.vacation_days_remaining {
                active_model.vacation_days_remaining = Set(v.max(0.0));
            }
            if let Some(v) = body.shift_preferences {
                active_model.shift_preferences = Set(v);
            }
            if let Some(v) = body.is_active {
                active_model.is_active = Set(v);
            }

            active_model.updated_at = Set(now);

            // Synchronize linked user account if one exists with the previous email
            if let Some(ref prev_email) = old_email {
                if !prev_email.trim().is_empty() {
                    if let Some(linked_user) = user::Entity::find()
                        .filter(user::Column::TenantId.eq(tenant_id))
                        .filter(user::Column::Email.eq(prev_email))
                        .one(txn)
                        .await?
                    {
                        let mut active_u: user::ActiveModel = linked_user.clone().into();
                        let mut user_changed = false;

                        if let Some(ref new_email) = body.email {
                            let trimmed = new_email.trim();
                            if !trimmed.is_empty() && trimmed != prev_email.trim() {
                                let collision = user::Entity::find()
                                    .filter(user::Column::TenantId.eq(tenant_id))
                                    .filter(user::Column::Email.eq(trimmed))
                                    .one(txn)
                                    .await?;
                                if collision.is_some() {
                                    return Err(AppError::Conflict(
                                        "Für die neue E-Mail-Adresse existiert bereits ein Benutzerkonto.".to_string(),
                                    ));
                                }
                                active_u.email = Set(trimmed.to_string());
                                user_changed = true;
                            }
                        }

                        if let Some(ref first) = body.first_name {
                            active_u.first_name = Set(first.clone());
                            user_changed = true;
                        }
                        if let Some(ref last) = body.last_name {
                            active_u.last_name = Set(last.clone());
                            user_changed = true;
                        }
                        if let Some(false) = body.is_active {
                            if linked_user.role == "admin" && linked_user.is_active {
                                let admin_count = user::Entity::find()
                                    .filter(user::Column::TenantId.eq(tenant_id))
                                    .filter(user::Column::Role.eq("admin"))
                                    .filter(user::Column::IsActive.eq(true))
                                    .count(txn)
                                    .await?;
                                if admin_count > 1 {
                                    active_u.is_active = Set(false);
                                    user_changed = true;
                                }
                            } else {
                                active_u.is_active = Set(false);
                                user_changed = true;
                            }
                        }

                        if user_changed {
                            active_u.updated_at = Set(now);
                            active_u.update(txn).await?;
                        }
                    }
                }
            }

            let model = active_model.update(txn).await?;
            Ok(model)
        })
    })
    .await?;

    let value = serde_json::to_value(model)
        .map_err(|e| AppError::InternalError(format!("Serialization error: {e}")))?;

    Ok(Json(value))
}

/// DELETE /:id – permanently delete an employee. Requires manager+ role.
async fn delete_employee(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;
    let tenant_id = auth.tenant_id;

    execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let existing = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            if let Some(ref emp_email) = existing.email {
                if !emp_email.trim().is_empty() {
                    if let Some(linked_user) = user::Entity::find()
                        .filter(user::Column::TenantId.eq(tenant_id))
                        .filter(user::Column::Email.eq(emp_email))
                        .one(txn)
                        .await?
                    {
                        if linked_user.role == "admin" && linked_user.is_active {
                            let admin_count = user::Entity::find()
                                .filter(user::Column::TenantId.eq(tenant_id))
                                .filter(user::Column::Role.eq("admin"))
                                .filter(user::Column::IsActive.eq(true))
                                .count(txn)
                                .await?;
                            if admin_count > 1 {
                                user::Entity::delete_by_id(linked_user.id).exec(txn).await?;
                            }
                        } else if linked_user.role != "super_admin" {
                            user::Entity::delete_by_id(linked_user.id).exec(txn).await?;
                        }
                    }
                }
            }

            Employee::delete_many()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;
            Ok(())
        })
    })
    .await?;

    Ok(Json(serde_json::json!({ "success": true, "message": "Mitarbeiter permanent gelöscht" })))
}

/// GET /me – get current employee profile associated with the logged-in user.
async fn get_current_employee(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let emp = execute_with_tenant(&state.db, &auth_user.tenant_id, |txn| {
        Box::pin(async move {
            let user_model = user::Entity::find()
                .filter(user::Column::Id.eq(auth_user.user_id))
                .filter(user::Column::TenantId.eq(auth_user.tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

            let all_emps = Employee::find()
                .filter(Column::TenantId.eq(auth_user.tenant_id))
                .all(txn)
                .await?;
            let emp_model = all_emps
                .into_iter()
                .find(|e| {
                    e.email
                        .as_deref()
                        .map(|em| !em.trim().is_empty() && em.trim().eq_ignore_ascii_case(user_model.email.trim()))
                        .unwrap_or(false)
                })
                .ok_or_else(|| AppError::NotFound("Zu diesem Benutzer wurde kein Mitarbeiterprofil gefunden.".to_string()))?;
            Ok(emp_model)
        })
    })
    .await?;

    let value = serde_json::to_value(emp)
        .map_err(|e| AppError::InternalError(format!("Serialization error: {e}")))?;

    Ok(Json(value))
}

#[derive(Deserialize)]
pub struct UpdateMyPreferencesRequest {
    pub shift_preferences: serde_json::Value,
}

/// PUT /me/preferences – update the logged-in employee's own shift preferences.
async fn update_my_preferences(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<UpdateMyPreferencesRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let now = chrono::Utc::now().fixed_offset();
    let updated = execute_with_tenant(&state.db, &auth_user.tenant_id, |txn| {
        Box::pin(async move {
            let user_model = user::Entity::find()
                .filter(user::Column::Id.eq(auth_user.user_id))
                .filter(user::Column::TenantId.eq(auth_user.tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

            let all_emps = Employee::find()
                .filter(Column::TenantId.eq(auth_user.tenant_id))
                .all(txn)
                .await?;
            let emp_model = all_emps
                .into_iter()
                .find(|e| {
                    e.email
                        .as_deref()
                        .map(|em| !em.trim().is_empty() && em.trim().eq_ignore_ascii_case(user_model.email.trim()))
                        .unwrap_or(false)
                })
                .ok_or_else(|| AppError::NotFound("Zu diesem Benutzer wurde kein Mitarbeiterprofil gefunden.".to_string()))?;

            let mut active: ActiveModel = emp_model.into();
            active.shift_preferences = Set(body.shift_preferences);
            active.updated_at = Set(now);
            let res = active.update(txn).await?;
            Ok(res)
        })
    })
    .await?;

    let value = serde_json::to_value(updated)
        .map_err(|e| AppError::InternalError(format!("Serialization error: {e}")))?;

    Ok(Json(value))
}

#[derive(Deserialize)]
pub struct CreateUserAccountRequest {
    pub password: Option<String>,
    pub role: Option<String>,
}

#[derive(Serialize)]
pub struct EmployeeUserAccountResponse {
    pub has_account: bool,
    pub user_id: Option<Uuid>,
    pub email: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
}

/// GET /:id/user-account – get the linked user account info for an employee.
async fn get_employee_user_account(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<EmployeeUserAccountResponse>, AppError> {
    require_manager(&auth)?;
    let tenant_id = auth.tenant_id;

    let account_info = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            let emp_email = emp.email.clone().unwrap_or_default();
            if emp_email.trim().is_empty() {
                return Ok(EmployeeUserAccountResponse {
                    has_account: false,
                    user_id: None,
                    email: None,
                    role: None,
                    is_active: None,
                });
            }

            let u = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .filter(user::Column::Email.eq(&emp_email))
                .one(txn)
                .await?;

            if let Some(user_model) = u {
                Ok(EmployeeUserAccountResponse {
                    has_account: true,
                    user_id: Some(user_model.id),
                    email: Some(user_model.email),
                    role: Some(user_model.role),
                    is_active: Some(user_model.is_active),
                })
            } else {
                Ok(EmployeeUserAccountResponse {
                    has_account: false,
                    user_id: None,
                    email: Some(emp_email),
                    role: None,
                    is_active: None,
                })
            }
        })
    })
    .await?;

    Ok(Json(account_info))
}

/// POST /:id/create-user – enable login credentials for an employee (creates a user account).
async fn create_employee_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateUserAccountRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let password = payload.password.unwrap_or_else(|| "start123".to_string());
    if password.len() < 6 {
        return Err(AppError::BadRequest("Das Passwort muss mindestens 6 Zeichen lang sein.".to_string()));
    }

    let role = payload.role.unwrap_or_else(|| "viewer".to_string());
    if !["viewer", "planner", "admin"].contains(&role.as_str()) {
        return Err(AppError::BadRequest("Ungültige Rolle. Erlaubt: viewer, planner, admin".to_string()));
    }
    if role != "viewer" {
        require_admin(&auth)?;
    }

    use argon2::{
        password_hash::{rand_core::OsRng, SaltString},
        Argon2, PasswordHasher,
    };

    // Hash the password with Argon2
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
        .to_string();

    let now = chrono::Utc::now().fixed_offset();
    let tenant_id = auth.tenant_id;
    let role_clone = role.clone();
    let pass_for_mail = password.clone();

    let (new_user_model, emp_name, emp_email) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let role = role_clone;
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            let emp_email = emp.email.clone().ok_or_else(|| AppError::BadRequest("Mitarbeiter hat keine E-Mail-Adresse hinterlegt.".to_string()))?;
            if emp_email.trim().is_empty() {
                return Err(AppError::BadRequest("Mitarbeiter hat keine E-Mail-Adresse hinterlegt.".to_string()));
            }

            // Check if user account already exists
            let existing = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .filter(user::Column::Email.eq(&emp_email))
                .one(txn)
                .await?;
            if existing.is_some() {
                return Err(AppError::Conflict("Für diese E-Mail-Adresse existiert bereits ein Benutzerkonto.".to_string()));
            }

            let first = emp.first_name.clone().unwrap_or_default();
            let last = emp.last_name.clone().unwrap_or_default();
            let full_name = format!("{} {}", first, last).trim().to_string();

            let new_u = user::ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                email: Set(emp_email.clone()),
                password_hash: Set(password_hash),
                first_name: Set(first),
                last_name: Set(last),
                role: Set(role),
                is_active: Set(true),
                created_at: Set(now),
                updated_at: Set(now),
            };

            let inserted = new_u.insert(txn).await?;
            Ok((inserted, full_name, emp_email))
        })
    })
    .await?;

    // Send welcome email notification asynchronously
    crate::services::email_service::notify_welcome_user(
        state.config.clone(),
        emp_email,
        emp_name,
        role,
        Some(pass_for_mail),
    );

    Ok(Json(serde_json::to_value(new_user_model).unwrap()))
}

#[derive(Deserialize)]
pub struct UpdateUserAccountRequest {
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub password: Option<String>,
}

/// PUT /:id/user-account – update linked user account role, active status, or password.
async fn update_employee_user_account(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateUserAccountRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(&auth)?;
    let tenant_id = auth.tenant_id;
    let now = chrono::Utc::now().fixed_offset();

    let (updated_user, role_changed, emp_email, emp_name, new_role, pw_changed, plain_pw) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let payload = payload;
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            let emp_email = emp.email.clone().ok_or_else(|| AppError::BadRequest("Mitarbeiter hat keine E-Mail-Adresse hinterlegt.".to_string()))?;
            let first = emp.first_name.clone().unwrap_or_default();
            let last = emp.last_name.clone().unwrap_or_default();
            let full_name = format!("{} {}", first, last).trim().to_string();

            let existing_user = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .filter(user::Column::Email.eq(&emp_email))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Zu diesem Mitarbeiter existiert kein Benutzerkonto.".to_string()))?;

            let mut active_u: user::ActiveModel = existing_user.clone().into();
            let mut role_changed = false;
            let mut target_role = existing_user.role.clone();

            if let Some(r) = payload.role {
                if !["viewer", "planner", "admin"].contains(&r.as_str()) {
                    return Err(AppError::BadRequest("Ungültige Rolle. Erlaubt: viewer, planner, admin".to_string()));
                }

                // If demoting an admin, ensure there is at least one other active admin
                if existing_user.role == "admin" && r != "admin" {
                    let admin_count = user::Entity::find()
                        .filter(user::Column::TenantId.eq(tenant_id))
                        .filter(user::Column::Role.eq("admin"))
                        .filter(user::Column::IsActive.eq(true))
                        .count(txn)
                        .await?;
                    if admin_count <= 1 {
                        return Err(AppError::BadRequest("Der einzige Administrator des Mandanten kann nicht herabgestuft werden.".to_string()));
                    }
                }

                if existing_user.role != r {
                    role_changed = true;
                    target_role = r.clone();
                    active_u.role = Set(r);
                }
            }

            if let Some(act) = payload.is_active {
                if existing_user.role == "admin" && !act {
                    let admin_count = user::Entity::find()
                        .filter(user::Column::TenantId.eq(tenant_id))
                        .filter(user::Column::Role.eq("admin"))
                        .filter(user::Column::IsActive.eq(true))
                        .count(txn)
                        .await?;
                    if admin_count <= 1 {
                        return Err(AppError::BadRequest("Der einzige Administrator des Mandanten kann nicht deaktiviert werden.".to_string()));
                    }
                }
                active_u.is_active = Set(act);
            }

            let mut pw_changed = false;
            let mut plain_pw = None;
            if let Some(new_pw) = payload.password.filter(|p| !p.trim().is_empty()) {
                if new_pw.len() < 6 {
                    return Err(AppError::BadRequest("Das Passwort muss mindestens 6 Zeichen lang sein.".to_string()));
                }
                use argon2::{password_hash::{rand_core::OsRng, SaltString}, Argon2, PasswordHasher};
                let salt = SaltString::generate(&mut OsRng);
                let argon2 = Argon2::default();
                let password_hash = argon2
                    .hash_password(new_pw.as_bytes(), &salt)
                    .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
                    .to_string();
                active_u.password_hash = Set(password_hash);
                pw_changed = true;
                plain_pw = Some(new_pw);
            }

            active_u.updated_at = Set(now);
            let updated = active_u.update(txn).await?;
            Ok((updated, role_changed, emp_email, full_name, target_role, pw_changed, plain_pw))
        })
    })
    .await?;

    if pw_changed {
        crate::services::email_service::notify_password_changed(
            state.config.clone(),
            emp_email.clone(),
            emp_name.clone(),
            plain_pw,
        );
    }

    if role_changed {
        crate::services::email_service::notify_role_updated(
            state.config.clone(),
            emp_email,
            emp_name,
            new_role,
        );
    }

    Ok(Json(serde_json::to_value(updated_user).unwrap()))
}
