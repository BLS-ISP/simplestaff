use axum::{
    extract::{Path, State},
    Json,
};
use chrono::NaiveDate;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::collections::HashMap;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::middleware::tenant::execute_with_tenant;
use crate::models::employee;
use crate::models::employee_vacation::{self, ActiveModel, Column, Entity as Vacation};
use crate::AppState;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateVacationRequest {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VacationResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub employee_id: Uuid,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

impl From<employee_vacation::Model> for VacationResponse {
    fn from(m: employee_vacation::Model) -> Self {
        Self {
            id: m.id,
            tenant_id: m.tenant_id,
            employee_id: m.employee_id,
            start_date: m.start_date,
            end_date: m.end_date,
            status: m.status,
            notes: m.notes,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
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





// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /employees/:employee_id/vacations
pub async fn list_vacations(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(employee_id): Path<Uuid>,
) -> Result<Json<Vec<VacationResponse>>, AppError> {
    let vacations = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let emp_exists = employee::Entity::find()
                .filter(employee::Column::Id.eq(employee_id))
                .filter(employee::Column::TenantId.eq(auth.tenant_id))
                .one(txn)
                .await?
                .is_some();
            if !emp_exists {
                return Err(AppError::NotFound("Employee not found".to_string()));
            }

            Vacation::find()
                .filter(Column::TenantId.eq(auth.tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .order_by_desc(Column::StartDate)
                .all(txn)
                .await
                .map_err(AppError::from)
        })
    })
    .await?;

    let response: Vec<VacationResponse> = vacations.into_iter().map(VacationResponse::from).collect();
    Ok(Json(response))
}

/// POST /employees/:employee_id/vacations
pub async fn create_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(employee_id): Path<Uuid>,
    Json(body): Json<CreateVacationRequest>,
) -> Result<Json<VacationResponse>, AppError> {
    if body.end_date < body.start_date {
        return Err(AppError::BadRequest(
            "end_date must not be before start_date".to_string(),
        ));
    }

    let now = chrono::Utc::now().into();
    let tenant_id = auth.tenant_id;

    let vacation = execute_with_tenant(&state.db, &tenant_id, |txn| {
        Box::pin(async move {
            let emp_exists = employee::Entity::find()
                .filter(employee::Column::Id.eq(employee_id))
                .filter(employee::Column::TenantId.eq(tenant_id))
                .one(txn)
                .await?
                .is_some();
            if !emp_exists {
                return Err(AppError::NotFound("Employee not found".to_string()));
            }

            let model = ActiveModel {
                id: Set(Uuid::new_v4()),
                tenant_id: Set(tenant_id),
                employee_id: Set(employee_id),
                start_date: Set(body.start_date),
                end_date: Set(body.end_date),
                status: Set("requested".to_string()),
                notes: Set(body.notes),
                created_at: Set(now),
                updated_at: Set(now),
            };

            model.insert(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(VacationResponse::from(vacation)))
}

/// PUT /employees/:employee_id/vacations/:id/approve
pub async fn approve_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((employee_id, vacation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<VacationResponse>, AppError> {
    require_manager(&auth)?;

    let vacation = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let vacation = Vacation::find()
                .filter(Column::Id.eq(vacation_id))
                .filter(Column::TenantId.eq(auth.tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Vacation not found".to_string()))?;

            let mut active: ActiveModel = vacation.into();
            active.status = Set("approved".to_string());
            active.updated_at = Set(chrono::Utc::now().into());

            active.update(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(VacationResponse::from(vacation)))
}

/// PUT /employees/:employee_id/vacations/:id/reject
pub async fn reject_vacation(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((employee_id, vacation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<VacationResponse>, AppError> {
    require_manager(&auth)?;

    let vacation = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let vacation = Vacation::find()
                .filter(Column::Id.eq(vacation_id))
                .filter(Column::TenantId.eq(auth.tenant_id))
                .filter(Column::EmployeeId.eq(employee_id))
                .one(txn)
                .await?
                .ok_or_else(|| AppError::NotFound("Vacation not found".to_string()))?;

            let mut active: ActiveModel = vacation.into();
            active.status = Set("rejected".to_string());
            active.updated_at = Set(chrono::Utc::now().into());

            active.update(txn).await.map_err(AppError::from)
        })
    })
    .await?;

    Ok(Json(VacationResponse::from(vacation)))
}

#[derive(Debug, Serialize)]
pub struct TenantVacationResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub employee_id: Uuid,
    pub employee_name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

/// GET /api/vacations – List all vacations for the current tenant. Requires manager.
pub async fn list_tenant_vacations(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<TenantVacationResponse>>, AppError> {
    require_manager(&auth)?;

    let (vacations, employees) = execute_with_tenant(&state.db, &auth.tenant_id, |txn| {
        Box::pin(async move {
            let vacs = Vacation::find()
                .filter(Column::TenantId.eq(auth.tenant_id))
                .order_by_desc(Column::StartDate)
                .all(txn)
                .await?;
            let emps = employee::Entity::find()
                .filter(employee::Column::TenantId.eq(auth.tenant_id))
                .all(txn)
                .await?;
            Ok((vacs, emps))
        })
    })
    .await?;

    let employee_map: HashMap<Uuid, employee::Model> = employees.into_iter().map(|e| (e.id, e)).collect();

    let response: Vec<TenantVacationResponse> = vacations
        .into_iter()
        .map(|v| {
            let emp_name = if let Some(emp) = employee_map.get(&v.employee_id) {
                let first = emp.first_name.as_deref().unwrap_or("");
                let last = emp.last_name.as_deref().unwrap_or("");
                format!("{} {}", first, last).trim().to_string()
            } else {
                "Unbekannt".to_string()
            };
            TenantVacationResponse {
                id: v.id,
                tenant_id: v.tenant_id,
                employee_id: v.employee_id,
                employee_name: emp_name,
                start_date: v.start_date,
                end_date: v.end_date,
                status: v.status,
                notes: v.notes,
                created_at: v.created_at,
                updated_at: v.updated_at,
            }
        })
        .collect();

    Ok(Json(response))
}
