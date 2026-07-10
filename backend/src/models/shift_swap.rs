use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "shift_swaps")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub assignment_id: Uuid,
    pub requesting_employee_id: Uuid,
    pub target_employee_id: Option<Uuid>,
    pub backup_employee_id: Option<Uuid>,
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
        belongs_to = "super::shift_assignment::Entity",
        from = "Column::AssignmentId",
        to = "super::shift_assignment::Column::Id"
    )]
    ShiftAssignment,
    #[sea_orm(
        belongs_to = "super::employee::Entity",
        from = "Column::RequestingEmployeeId",
        to = "super::employee::Column::Id"
    )]
    RequestingEmployee,
}

impl Related<super::tenant::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tenant.def()
    }
}

impl Related<super::shift_assignment::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ShiftAssignment.def()
    }
}

impl Related<super::employee::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RequestingEmployee.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
