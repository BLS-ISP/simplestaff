use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "shift_assignments")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub employee_id: Uuid,
    pub shift_type_id: Uuid,
    pub assignment_date: Date,
    pub actual_start: Option<chrono::NaiveTime>,
    pub actual_end: Option<chrono::NaiveTime>,
    pub actual_break_minutes: Option<i32>,
    pub status: String,
    pub notes: Option<String>,
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
        belongs_to = "super::employee::Entity",
        from = "Column::EmployeeId",
        to = "super::employee::Column::Id"
    )]
    Employee,
    #[sea_orm(
        belongs_to = "super::shift_type::Entity",
        from = "Column::ShiftTypeId",
        to = "super::shift_type::Column::Id"
    )]
    ShiftType,
}

impl Related<super::tenant::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tenant.def()
    }
}

impl Related<super::employee::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Employee.def()
    }
}

impl Related<super::shift_type::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ShiftType.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
