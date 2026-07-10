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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_employees).post(create_employee))
        .route("/me", get(get_current_employee))
        .route("/{id}", get(get_employee).put(update_employee).delete(delete_employee))
        .route("/{id}/create-user", post(create_employee_user))
        
        .route("/{employee_id}/blocked-days", get(blocked_days::list_blocked_days).post(blocked_days::create_blocked_day))
        .route("/{employee_id}/blocked-days/", get(blocked_days::list_blocked_days).post(blocked_days::create_blocked_day))
        .route("/{employee_id}/blocked-days/{id}", delete(blocked_days::delete_blocked_day))
        
        .route("/{employee_id}/vacations", get(vacations::list_vacations).post(vacations::create_vacation))
        .route("/{employee_id}/vacations/", get(vacations::list_vacations).post(vacations::create_vacation))
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
async fn get_employee(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let tenant_id = auth.tenant_id;
    let model = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            Employee::find()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Employee {id} not found")))
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
                vacation_days_per_year: Set(body.vacation_days_per_year.unwrap_or(30)),
                vacation_days_remaining: Set(body.vacation_days_remaining.unwrap_or(30.0)),
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

            let mut active_model: ActiveModel = existing.into();

            if let Some(v) = body.first_name {
                active_model.first_name = Set(Some(v));
            }
            if let Some(v) = body.last_name {
                active_model.last_name = Set(Some(v));
            }
            if let Some(v) = body.email {
                active_model.email = Set(Some(v));
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
            }
            if let Some(v) = body.vacation_days_remaining {
                active_model.vacation_days_remaining = Set(v);
            }
            if let Some(v) = body.shift_preferences {
                active_model.shift_preferences = Set(v);
            }
            if let Some(v) = body.is_active {
                active_model.is_active = Set(v);
            }

            active_model.updated_at = Set(now);

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
            let delete_res = Employee::delete_many()
                .filter(Column::Id.eq(id))
                .filter(Column::TenantId.eq(tenant_id))
                .exec(txn)
                .await?;
            if delete_res.rows_affected == 0 {
                return Err(AppError::NotFound(format!("Employee {id} not found")));
            }
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

            let emp_model = Employee::find()
                .filter(Column::TenantId.eq(auth_user.tenant_id))
                .filter(Column::Email.eq(user_model.email))
                .one(txn)
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
pub struct CreateUserAccountRequest {
    pub password: Option<String>,
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

    let new_user_model = execute_with_tenant(&state.db, &tenant_id, |txn| {
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

            let new_u = user::ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                email: Set(emp_email),
                password_hash: Set(password_hash),
                first_name: Set(emp.first_name.unwrap_or_default()),
                last_name: Set(emp.last_name.unwrap_or_default()),
                role: Set("viewer".to_string()),
                is_active: Set(true),
                created_at: Set(now),
                updated_at: Set(now),
            };

            let inserted = new_u.insert(txn).await?;
            Ok(inserted)
        })
    })
    .await?;

    Ok(Json(serde_json::to_value(new_user_model).unwrap()))
}
