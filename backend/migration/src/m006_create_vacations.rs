use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(EmployeeVacations::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(EmployeeVacations::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(
                        ColumnDef::new(EmployeeVacations::TenantId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EmployeeVacations::EmployeeId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EmployeeVacations::StartDate)
                            .date()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EmployeeVacations::EndDate)
                            .date()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EmployeeVacations::Status)
                            .string()
                            .not_null()
                            .default("requested"),
                    )
                    .col(ColumnDef::new(EmployeeVacations::Notes).text())
                    .col(
                        ColumnDef::new(EmployeeVacations::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(EmployeeVacations::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_vacations_tenant_id")
                            .from(EmployeeVacations::Table, EmployeeVacations::TenantId)
                            .to(Tenants::Table, Tenants::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_vacations_employee_id")
                            .from(EmployeeVacations::Table, EmployeeVacations::EmployeeId)
                            .to(Employees::Table, Employees::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Index on (tenant_id, employee_id)
        manager
            .create_index(
                Index::create()
                    .name("idx_vacations_tenant_employee")
                    .table(EmployeeVacations::Table)
                    .col(EmployeeVacations::TenantId)
                    .col(EmployeeVacations::EmployeeId)
                    .to_owned(),
            )
            .await?;

        // Index on (tenant_id, status)
        manager
            .create_index(
                Index::create()
                    .name("idx_vacations_tenant_status")
                    .table(EmployeeVacations::Table)
                    .col(EmployeeVacations::TenantId)
                    .col(EmployeeVacations::Status)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(EmployeeVacations::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum EmployeeVacations {
    Table,
    Id,
    TenantId,
    EmployeeId,
    StartDate,
    EndDate,
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
