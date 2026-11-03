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
use crate::models::employee::{self, ActiveModel, Column, Entity as Employee};
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
    pub user_id: Option<Uuid>,
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
    pub protection_profile: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct CreateSelfProfileRequest {
    pub weekly_hours: Option<f32>,
    pub vacation_days_per_year: Option<i32>,
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
    pub protection_profile: Option<String>,
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

async fn find_user_by_email_ci(
    txn: &sea_orm::DatabaseTransaction,
    tenant_id: Uuid,
    email: &str,
) -> Result<Option<user::Model>, AppError> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let users = user::Entity::find()
        .filter(user::Column::TenantId.eq(tenant_id))
        .all(txn)
        .await?;
    Ok(users
        .into_iter()
        .find(|u| u.email.trim().eq_ignore_ascii_case(trimmed)))
}

async fn find_user_for_employee(
    txn: &sea_orm::DatabaseTransaction,
    tenant_id: Uuid,
    emp: &employee::Model,
) -> Result<Option<user::Model>, AppError> {
    if let Some(uid) = emp.user_id {
        if let Some(u) = user::Entity::find()
            .filter(user::Column::Id.eq(uid))
            .filter(user::Column::TenantId.eq(tenant_id))
            .one(txn)
            .await?
        {
            return Ok(Some(u));
        }
    }

    if let Some(ref emp_email) = emp.email {
        if !emp_email.trim().is_empty() {
            return find_user_by_email_ci(txn, tenant_id, emp_email).await;
        }
    }

    Ok(None)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_employees).post(create_employee))
        .route("/me", get(get_current_employee))
        .route("/me/preferences", put(update_my_preferences))
        .route("/self-profile", post(create_or_link_self_employee))
        .route("/{id}", get(get_employee).put(update_employee).delete(delete_employee))
        .route("/{id}/create-user", post(create_employee_user))
        .route("/{id}/link-user", post(link_employee_user_account))
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

                if !employee::is_owned_by_user(&emp, &current_user) {
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
            // Determine if this employee should be automatically linked to an existing unlinked user account in the tenant
            let mut linked_uid = body.user_id;
            if linked_uid.is_none() {
                if let Some(ref em) = body.email {
                    if let Some(existing_user) = find_user_by_email_ci(txn, tenant_id, em).await? {
                        let already_taken = Employee::find()
                            .filter(Column::TenantId.eq(tenant_id))
                            .filter(Column::UserId.eq(existing_user.id))
                            .one(txn)
                            .await?
                            .is_some();
                        if !already_taken {
                            linked_uid = Some(existing_user.id);
                        }
                    }
                }
            }

            let vac_per_year = body.vacation_days_per_year.unwrap_or(30);
            let vac_remaining = body.vacation_days_remaining.unwrap_or(vac_per_year as f32);
            let mut shift_prefs = body.shift_preferences.unwrap_or_else(|| serde_json::json!({}));
            if !shift_prefs.is_object() {
                shift_prefs = serde_json::json!({});
            }
            if let Some(ref prof) = body.protection_profile {
                let trimmed = prof.trim();
                if matches!(trimmed, "standard" | "youth" | "youth_hospitality" | "maternity") {
                    shift_prefs["_protection_profile"] = serde_json::Value::String(trimmed.to_string());
                }
            }
            let monthly_hours_opt = body.monthly_hours.filter(|&v| v > 0.0);
            let active_model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                user_id: Set(linked_uid),
                first_name: Set(body.first_name),
                last_name: Set(body.last_name),
                email: Set(body.email),
                phone: Set(body.phone),
                weekly_hours: Set(body.weekly_hours.unwrap_or(40.0)),
                monthly_hours: Set(monthly_hours_opt),
                yearly_hours: Set(body.yearly_hours),
                vacation_days_per_year: Set(vac_per_year),
                vacation_days_remaining: Set(vac_remaining),
                shift_preferences: Set(shift_prefs),
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

/// POST /self-profile – creates or links an employee profile for the currently logged-in manager/admin
/// so that a tenant's master account can also be scheduled on the shift plan.
async fn create_or_link_self_employee(
    State(state): State<AppState>,
    auth: AuthUser,
    body: Option<Json<CreateSelfProfileRequest>>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_manager(&auth)?;

    let req = body.map(|Json(b)| b).unwrap_or_default();
    let tenant_id = auth.tenant_id;
    let user_id = auth.user_id;
    let now = chrono::Utc::now().fixed_offset();

    let tenant = tenant::Entity::find_by_id(tenant_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden".to_string()))?;

    let max_employees = tenant.settings.get("max_employees").and_then(|v| v.as_u64());

    let model = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let current_user = user::Entity::find()
                .filter(user::Column::Id.eq(user_id))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Benutzer nicht gefunden.".to_string()))?;

            // Check if an employee record is already linked or matches by email
            if let Some(existing_emp) = employee::find_for_user(txn, tenant_id, &current_user).await? {
                if existing_emp.user_id != Some(user_id) {
                    let mut active_emp: ActiveModel = existing_emp.into();
                    active_emp.user_id = Set(Some(user_id));
                    active_emp.updated_at = Set(now);
                    return Ok(active_emp.update(txn).await?);
                }
                return Ok(existing_emp);
            }

            if let Some(limit) = max_employees {
                let count = Employee::find()
                    .filter(Column::TenantId.eq(tenant_id))
                    .filter(Column::IsActive.eq(true))
                    .count(txn)
                    .await?;
                if count >= limit {
                    return Err(AppError::BadRequest(format!(
                        "Mitarbeiterlimit von {} für diesen Mandanten erreicht.",
                        limit
                    )));
                }
            }

            let vac_per_year = req.vacation_days_per_year.unwrap_or(30);
            let weekly_hours = req.weekly_hours.unwrap_or(40.0);

            let first = if current_user.first_name.trim().is_empty() {
                "Betriebsleiter".to_string()
            } else {
                current_user.first_name.clone()
            };

            let new_emp = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                user_id: Set(Some(user_id)),
                first_name: Set(Some(first)),
                last_name: Set(Some(current_user.last_name.clone())),
                email: Set(Some(current_user.email.clone())),
                phone: Set(None),
                weekly_hours: Set(weekly_hours),
                monthly_hours: Set(None),
                yearly_hours: Set(None),
                vacation_days_per_year: Set(vac_per_year),
                vacation_days_remaining: Set(vac_per_year as f32),
                shift_preferences: Set(serde_json::json!({})),
                is_active: Set(true),
                created_at: Set(now),
                updated_at: Set(now),
            };

            Ok(new_emp.insert(txn).await?)
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

            let linked_user_opt = find_user_for_employee(txn, tenant_id, &existing).await?;
            let old_vac_per_year = existing.vacation_days_per_year;
            let old_vac_remaining = existing.vacation_days_remaining;
            let existing_prefs = existing.shift_preferences.clone();
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
                if v <= 0.0 {
                    active_model.monthly_hours = Set(None);
                } else {
                    active_model.monthly_hours = Set(Some(v));
                }
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
            if body.shift_preferences.is_some() || body.protection_profile.is_some() {
                let mut merged_prefs = body.shift_preferences.unwrap_or_else(|| existing_prefs.clone());
                if !merged_prefs.is_object() {
                    merged_prefs = serde_json::json!({});
                }
                // Preserve existing underscore metadata keys if not explicitly replaced
                if let Some(existing_obj) = existing_prefs.as_object() {
                    if let Some(new_obj) = merged_prefs.as_object_mut() {
                        for (k, val) in existing_obj {
                            if k.starts_with('_') && !new_obj.contains_key(k) {
                                new_obj.insert(k.clone(), val.clone());
                            }
                        }
                    }
                }
                if let Some(ref prof) = body.protection_profile {
                    let trimmed = prof.trim();
                    if matches!(trimmed, "standard" | "youth" | "youth_hospitality" | "maternity") {
                        merged_prefs["_protection_profile"] = serde_json::Value::String(trimmed.to_string());
                    }
                }
                active_model.shift_preferences = Set(merged_prefs);
            }
            if let Some(v) = body.is_active {
                active_model.is_active = Set(v);
            }

            active_model.updated_at = Set(now);

            // Synchronize linked user account if one exists
            if let Some(linked_user) = linked_user_opt {
                active_model.user_id = Set(Some(linked_user.id));

                let mut active_u: user::ActiveModel = linked_user.clone().into();
                let mut user_changed = false;

                if let Some(ref new_email) = body.email {
                    let trimmed = new_email.trim();
                    if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case(linked_user.email.trim()) {
                        let collision = find_user_by_email_ci(txn, tenant_id, trimmed).await?;
                        if collision.filter(|u| u.id != linked_user.id).is_some() {
                            return Err(AppError::Conflict(
                                "Für die neue E-Mail-Adresse existiert in diesem Mandanten bereits ein anderes Benutzerkonto.".to_string(),
                            ));
                        }
                        active_u.email = Set(trimmed.to_string());
                        user_changed = true;
                    } else if !trimmed.is_empty() && trimmed != linked_user.email {
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

            if let Some(linked_user) = find_user_for_employee(txn, tenant_id, &existing).await? {
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

            let emp_model = employee::find_for_user(txn, auth_user.tenant_id, &user_model)
                .await?
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

            let emp_model = employee::find_for_user(txn, auth_user.tenant_id, &user_model)
                .await?
                .ok_or_else(|| AppError::NotFound("Zu diesem Benutzer wurde kein Mitarbeiterprofil gefunden.".to_string()))?;

            let existing_prefs = emp_model.shift_preferences.clone();
            let mut new_prefs = body.shift_preferences;
            if !new_prefs.is_object() {
                new_prefs = serde_json::json!({});
            }
            // Preserve protected metadata keys (e.g. _protection_profile) so employees cannot alter them
            if let Some(existing_obj) = existing_prefs.as_object() {
                if let Some(new_obj) = new_prefs.as_object_mut() {
                    for (k, val) in existing_obj {
                        if k.starts_with('_') {
                            new_obj.insert(k.clone(), val.clone());
                        }
                    }
                }
            }

            let mut active: ActiveModel = emp_model.into();
            active.shift_preferences = Set(new_prefs);
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
    pub username: Option<String>,
    pub password: Option<String>,
    pub role: Option<String>,
}

#[derive(Deserialize)]
pub struct LinkUserAccountRequest {
    pub user_id: Uuid,
}

#[derive(Serialize)]
pub struct UnlinkedUserInfo {
    pub id: Uuid,
    pub email: String,
    pub username: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
}

#[derive(Serialize)]
pub struct EmployeeUserAccountResponse {
    pub has_account: bool,
    pub user_id: Option<Uuid>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub unlinked_users: Vec<UnlinkedUserInfo>,
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

            // Find all users in this tenant not yet linked to any employee
            let all_emps = Employee::find()
                .filter(Column::TenantId.eq(tenant_id))
                .all(txn)
                .await?;
            let all_users = user::Entity::find()
                .filter(user::Column::TenantId.eq(tenant_id))
                .all(txn)
                .await?;

            let linked_user_ids: std::collections::HashSet<Uuid> = all_emps
                .iter()
                .filter_map(|e| e.user_id)
                .collect();

            let unlinked_users: Vec<UnlinkedUserInfo> = all_users
                .iter()
                .filter(|u| !linked_user_ids.contains(&u.id))
                .map(|u| UnlinkedUserInfo {
                    id: u.id,
                    email: u.email.clone(),
                    username: u.username.clone(),
                    first_name: u.first_name.clone(),
                    last_name: u.last_name.clone(),
                    role: u.role.clone(),
                })
                .collect();

            let u = find_user_for_employee(txn, tenant_id, &emp).await?;

            if let Some(user_model) = u {
                Ok(EmployeeUserAccountResponse {
                    has_account: true,
                    user_id: Some(user_model.id),
                    email: Some(user_model.email),
                    username: user_model.username,
                    role: Some(user_model.role),
                    is_active: Some(user_model.is_active),
                    unlinked_users,
                })
            } else {
                Ok(EmployeeUserAccountResponse {
                    has_account: false,
                    user_id: None,
                    email: emp.email.filter(|s| !s.trim().is_empty()),
                    username: None,
                    role: None,
                    is_active: None,
                    unlinked_users,
                })
            }
        })
    })
    .await?;

    Ok(Json(account_info))
}

/// POST /:id/link-user – explicitly link an existing user account in the tenant (e.g. master admin) to this employee.
async fn link_employee_user_account(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<LinkUserAccountRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(&auth)?;
    let tenant_id = auth.tenant_id;
    let target_uid = payload.user_id;
    let now = chrono::Utc::now().fixed_offset();

    let updated_emp = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            let target_user = user::Entity::find()
                .filter(user::Column::Id.eq(target_uid))
                .filter(user::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Benutzerkonto im Mandanten nicht gefunden.".to_string()))?;

            let already_linked = Employee::find()
                .filter(Column::TenantId.eq(tenant_id))
                .filter(Column::UserId.eq(target_uid))
                .filter(Column::Id.ne(id))
                .one(txn)
                .await?;
            if already_linked.is_some() {
                return Err(AppError::Conflict(
                    "Dieses Benutzerkonto ist bereits mit einem anderen Mitarbeiterprofil verknüpft.".to_string(),
                ));
            }

            let emp_email_empty = emp.email.as_deref().unwrap_or("").trim().is_empty();
            let mut active_emp: ActiveModel = emp.into();
            active_emp.user_id = Set(Some(target_user.id));
            if emp_email_empty {
                active_emp.email = Set(Some(target_user.email));
            }
            active_emp.updated_at = Set(now);

            Ok(active_emp.update(txn).await?)
        })
    })
    .await?;

    Ok(Json(serde_json::to_value(updated_emp).unwrap()))
}

/// POST /:id/create-user – enable login credentials for an employee (creates a user account and links `user_id`).
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

    let tenant_model = tenant::Entity::find_by_id(auth.tenant_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Mandant nicht gefunden.".to_string()))?;

    let explicit_username = if let Some(ref raw_u) = payload.username.as_ref().filter(|s| !s.trim().is_empty()) {
        let validated = user::validate_username_format(raw_u)?;
        if user::is_username_taken(&state.db, &validated, None).await? {
            return Err(AppError::Conflict(
                "Dieser Benutzername ist bereits vergeben.".to_string(),
            ));
        }
        Some(validated)
    } else {
        None
    };

    use argon2::{
        password_hash::{rand_core::OsRng, SaltString},
        Argon2, PasswordHasher,
    };

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::InternalError(format!("Passworthash fehlgeschlagen: {e}")))?
        .to_string();

    let now = chrono::Utc::now().fixed_offset();
    let tenant_id = auth.tenant_id;
    let tenant_slug = tenant_model.slug.clone();
    let role_clone = role.clone();
    let pass_for_mail = password.clone();
    let db_for_uname = state.db.clone();

    let (new_user_model, emp_name, emp_email, has_real_email) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let role = role_clone;
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            if let Some(existing_linked) = find_user_for_employee(txn, tenant_id, &emp).await? {
                return Err(AppError::Conflict(format!(
                    "Für diesen Mitarbeiter existiert bereits ein Benutzerkonto ({}).",
                    existing_linked.email
                )));
            }

            let first = emp.first_name.clone().unwrap_or_default();
            let last = emp.last_name.clone().unwrap_or_default();
            let full_name = format!("{} {}", first, last).trim().to_string();

            let raw_emp_email = emp.email.clone().unwrap_or_default();
            let has_real_email = !raw_emp_email.trim().is_empty();

            let final_username = if let Some(u) = explicit_username {
                u
            } else {
                let hint = if has_real_email {
                    raw_emp_email.trim().to_string()
                } else {
                    format!("{}.{}", first, last)
                };
                user::generate_unique_username(&db_for_uname, &hint, &tenant_slug, None).await?
            };

            let clean_email = if has_real_email {
                raw_emp_email.trim().to_string()
            } else {
                format!("{}@{}.local", final_username, tenant_slug)
            };

            // Check if email already exists in this tenant
            if let Some(_existing) = find_user_by_email_ci(txn, tenant_id, &clean_email).await? {
                return Err(AppError::Conflict(
                    "Für diese E-Mail-Adresse existiert in diesem Mandanten bereits ein Benutzerkonto. Sie können es direkt verknüpfen.".to_string(),
                ));
            }

            let new_uid = Uuid::new_v4();
            let new_u = user::ActiveModel {
                id: Set(new_uid),
                tenant_id: Set(tenant_id),
                email: Set(clean_email.clone()),
                username: Set(Some(final_username)),
                password_hash: Set(password_hash),
                first_name: Set(first),
                last_name: Set(last),
                role: Set(role),
                is_active: Set(true),
                created_at: Set(now),
                updated_at: Set(now),
            };

            let inserted = new_u.insert(txn).await?;

            // Explicitly link `employees.user_id`
            let mut active_emp: ActiveModel = emp.into();
            active_emp.user_id = Set(Some(new_uid));
            if !has_real_email {
                active_emp.email = Set(Some(clean_email.clone()));
            }
            active_emp.updated_at = Set(now);
            active_emp.update(txn).await?;

            Ok((inserted, full_name, clean_email, has_real_email))
        })
    })
    .await?;

    if has_real_email {
        crate::services::email_service::notify_welcome_user(
            state.config.clone(),
            emp_email,
            emp_name,
            role,
            Some(pass_for_mail),
        );
    }

    Ok(Json(serde_json::to_value(new_user_model).unwrap()))
}

#[derive(Deserialize)]
pub struct UpdateUserAccountRequest {
    pub username: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
    pub password: Option<String>,
}

/// PUT /:id/user-account – update linked user account username, role, active status, or password.
async fn update_employee_user_account(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateUserAccountRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(&auth)?;
    let tenant_id = auth.tenant_id;
    let now = chrono::Utc::now().fixed_offset();
    let db_conn = state.db.clone();

    let (updated_user, role_changed, emp_email, emp_name, new_role, pw_changed, plain_pw) = execute_with_tenant(&state.db, &tenant_id, |txn| {
        let payload = payload;
        Box::pin(async move {
            let emp = Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))?;

            let first = emp.first_name.clone().unwrap_or_default();
            let last = emp.last_name.clone().unwrap_or_default();
            let full_name = format!("{} {}", first, last).trim().to_string();

            let existing_user = find_user_for_employee(txn, tenant_id, &emp)
                .await?
                .ok_or_else(|| AppError::NotFound("Zu diesem Mitarbeiter existiert kein Benutzerkonto.".to_string()))?;

            // Ensure `employees.user_id` is explicitly set
            if emp.user_id != Some(existing_user.id) {
                let mut active_emp: ActiveModel = emp.into();
                active_emp.user_id = Set(Some(existing_user.id));
                active_emp.updated_at = Set(now);
                active_emp.update(txn).await?;
            }

            let mut active_u: user::ActiveModel = existing_user.clone().into();
            let mut role_changed = false;
            let mut target_role = existing_user.role.clone();

            if let Some(ref raw_uname) = payload.username {
                let trimmed = raw_uname.trim();
                if !trimmed.is_empty() {
                    let validated = user::validate_username_format(trimmed)?;
                    if user::is_username_taken(&db_conn, &validated, Some(existing_user.id)).await? {
                        return Err(AppError::Conflict(
                            "Dieser Benutzername ist bereits vergeben.".to_string(),
                        ));
                    }
                    active_u.username = Set(Some(validated));
                }
            }

            if let Some(r) = payload.role {
                if !["viewer", "planner", "admin"].contains(&r.as_str()) {
                    return Err(AppError::BadRequest("Ungültige Rolle. Erlaubt: viewer, planner, admin".to_string()));
                }

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
            Ok((updated.clone(), role_changed, updated.email, full_name, target_role, pw_changed, plain_pw))
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
