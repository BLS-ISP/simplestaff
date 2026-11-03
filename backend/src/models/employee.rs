use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "employees")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub user_id: Option<Uuid>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub weekly_hours: f32,
    pub monthly_hours: Option<f32>,
    pub yearly_hours: Option<f32>,
    pub vacation_days_per_year: i32,
    pub vacation_days_remaining: f32,
    #[sea_orm(column_type = "JsonBinary")]
    pub shift_preferences: serde_json::Value,
    pub is_active: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::tenant::Entity",
        from = "Column::TenantId",
        to = "super::tenant::Column::Id"
    )]
    Tenant,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id"
    )]
    User,
    #[sea_orm(has_many = "super::employee_blocked_day::Entity")]
    BlockedDays,
    #[sea_orm(has_many = "super::employee_vacation::Entity")]
    Vacations,
    #[sea_orm(has_many = "super::shift_assignment::Entity")]
    ShiftAssignments,
}

impl Related<super::tenant::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tenant.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl Related<super::employee_blocked_day::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::BlockedDays.def()
    }
}

impl Related<super::employee_vacation::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Vacations.def()
    }
}

impl Related<super::shift_assignment::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ShiftAssignments.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// Checks if `emp` belongs to `user_model`, prioritizing explicit `user_id` linkage
/// with a fallback to case-insensitive email matching when `emp.user_id` is `None`.
pub fn is_owned_by_user(emp: &Model, user_model: &super::user::Model) -> bool {
    if let Some(linked_uid) = emp.user_id {
        return linked_uid == user_model.id;
    }
    emp.email
        .as_deref()
        .map(|em| !em.trim().is_empty() && em.trim().eq_ignore_ascii_case(user_model.email.trim()))
        .unwrap_or(false)
}

/// Returns the labor law protection profile stored in `emp.shift_preferences["_protection_profile"]`.
/// Possible values:
/// - `"standard"` (Volljährig, reguläres ArbZG)
/// - `"youth"` (Jugendlicher < 18 J. nach JArbSchG)
/// - `"youth_hospitality"` (Jugendlicher >= 16 J. Gastro/Hotellerie/Bäckerei nach § 14 Abs. 2 JArbSchG)
/// - `"maternity"` (Schwangere/Stillende nach MuSchG)
pub fn get_protection_profile(emp: &Model) -> &str {
    emp.shift_preferences
        .get("_protection_profile")
        .and_then(|v| v.as_str())
        .filter(|s| matches!(*s, "standard" | "youth" | "youth_hospitality" | "maternity"))
        .unwrap_or("standard")
}

/// Safely extracts the numeric shift preference (1..=5, default 3) for a given shift type and weekday (1=Mon..7=Sun),
/// ignoring non-numeric metadata keys such as `"_protection_profile"`.
pub fn get_shift_pref(emp: &Model, shift_type_id: &Uuid, day_of_week: u32) -> i32 {
    let pref_key = format!("{}:{}", shift_type_id, day_of_week);
    emp.shift_preferences
        .get(&pref_key)
        .and_then(|v| v.as_i64())
        .or_else(|| {
            emp.shift_preferences
                .get(&shift_type_id.to_string())
                .and_then(|v| v.as_i64())
        })
        .map(|n| n as i32)
        .unwrap_or(3)
}

/// Finds the employee profile linked to `user_model` within `tenant_id`.
/// Prioritizes `employees.user_id = user_model.id`, falling back to case-insensitive email match.
pub async fn find_for_user(
    txn: &sea_orm::DatabaseTransaction,
    tenant_id: Uuid,
    user_model: &super::user::Model,
) -> Result<Option<Model>, AppError> {
    if let Some(by_uid) = Entity::find()
        .filter(Column::TenantId.eq(tenant_id))
        .filter(Column::UserId.eq(user_model.id))
        .one(txn)
        .await?
    {
        return Ok(Some(by_uid));
    }

    let user_email = user_model.email.trim();
    if user_email.is_empty() {
        return Ok(None);
    }

    let all_emps = Entity::find()
        .filter(Column::TenantId.eq(tenant_id))
        .all(txn)
        .await?;

    Ok(all_emps.into_iter().find(|e| {
        e.user_id.is_none()
            && e.email
                .as_deref()
                .map(|em| !em.trim().is_empty() && em.trim().eq_ignore_ascii_case(user_email))
                .unwrap_or(false)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_owned_by_user_prioritizes_user_id() {
        let now: DateTimeWithTimeZone = chrono::Utc::now().into();
        let tid = Uuid::new_v4();
        let uid1 = Uuid::new_v4();
        let uid2 = Uuid::new_v4();

        let u1 = super::super::user::Model {
            id: uid1,
            tenant_id: tid,
            email: "admin@firma.de".to_string(),
            username: Some("admin.firma".to_string()),
            password_hash: "hash".to_string(),
            first_name: "Max".to_string(),
            last_name: "Chef".to_string(),
            role: "admin".to_string(),
            is_active: true,
            created_at: now,
            updated_at: now,
        };

        let emp_linked_to_u1_diff_email = Model {
            id: Uuid::new_v4(),
            tenant_id: tid,
            user_id: Some(uid1),
            first_name: Some("Max".to_string()),
            last_name: Some("Chef".to_string()),
            email: Some("private@gmail.com".to_string()),
            phone: None,
            weekly_hours: 40.0,
            monthly_hours: None,
            yearly_hours: None,
            vacation_days_per_year: 30,
            vacation_days_remaining: 30.0,
            shift_preferences: serde_json::json!({}),
            is_active: true,
            created_at: now,
            updated_at: now,
        };

        let emp_linked_to_u2_same_email = Model {
            user_id: Some(uid2),
            email: Some("admin@firma.de".to_string()),
            ..emp_linked_to_u1_diff_email.clone()
        };

        assert!(is_owned_by_user(&emp_linked_to_u1_diff_email, &u1));
        assert!(!is_owned_by_user(&emp_linked_to_u2_same_email, &u1));
    }
}

