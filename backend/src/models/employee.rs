use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "employees")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
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
