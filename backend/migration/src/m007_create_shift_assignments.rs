use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ShiftAssignments::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ShiftAssignments::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(
                        ColumnDef::new(ShiftAssignments::TenantId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ShiftAssignments::EmployeeId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ShiftAssignments::ShiftTypeId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ShiftAssignments::AssignmentDate)
                            .date()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ShiftAssignments::ActualStart).time())
                    .col(ColumnDef::new(ShiftAssignments::ActualEnd).time())
                    .col(ColumnDef::new(ShiftAssignments::ActualBreakMinutes).integer())
                    .col(
                        ColumnDef::new(ShiftAssignments::Status)
                            .string()
                            .not_null()
                            .default("planned"),
                    )
                    .col(ColumnDef::new(ShiftAssignments::Notes).text())
                    .col(
                        ColumnDef::new(ShiftAssignments::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ShiftAssignments::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_assignments_tenant_id")
                            .from(ShiftAssignments::Table, ShiftAssignments::TenantId)
                            .to(Tenants::Table, Tenants::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_assignments_employee_id")
                            .from(ShiftAssignments::Table, ShiftAssignments::EmployeeId)
                            .to(Employees::Table, Employees::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_assignments_shift_type_id")
                            .from(ShiftAssignments::Table, ShiftAssignments::ShiftTypeId)
                            .to(ShiftTypes::Table, ShiftTypes::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // UNIQUE constraint on (employee_id, assignment_date, shift_type_id)
        manager
            .create_index(
                Index::create()
                    .name("idx_shift_assignments_employee_date_type_unique")
                    .table(ShiftAssignments::Table)
                    .col(ShiftAssignments::EmployeeId)
                    .col(ShiftAssignments::AssignmentDate)
                    .col(ShiftAssignments::ShiftTypeId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Index on (tenant_id, assignment_date)
        manager
            .create_index(
                Index::create()
                    .name("idx_shift_assignments_tenant_date")
                    .table(ShiftAssignments::Table)
                    .col(ShiftAssignments::TenantId)
                    .col(ShiftAssignments::AssignmentDate)
                    .to_owned(),
            )
            .await?;

        // Index on (tenant_id, employee_id)
        manager
            .create_index(
                Index::create()
                    .name("idx_shift_assignments_tenant_employee")
                    .table(ShiftAssignments::Table)
                    .col(ShiftAssignments::TenantId)
                    .col(ShiftAssignments::EmployeeId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(ShiftAssignments::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ShiftAssignments {
    Table,
    Id,
    TenantId,
    EmployeeId,
    ShiftTypeId,
    AssignmentDate,
    ActualStart,
    ActualEnd,
    ActualBreakMinutes,
    Status,
    Notes,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Tenants {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Employees {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum ShiftTypes {
    Table,
    Id,
}
