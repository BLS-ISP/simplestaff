use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Employees::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Employees::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(ColumnDef::new(Employees::TenantId).uuid().not_null())
                    .col(ColumnDef::new(Employees::FirstName).string())
                    .col(ColumnDef::new(Employees::LastName).string())
                    .col(ColumnDef::new(Employees::Email).string())
                    .col(ColumnDef::new(Employees::Phone).string())
                    .col(
                        ColumnDef::new(Employees::WeeklyHours)
                            .float()
                            .not_null()
                            .default(40.0),
                    )
                    .col(ColumnDef::new(Employees::MonthlyHours).float())
                    .col(ColumnDef::new(Employees::YearlyHours).float())
                    .col(
                        ColumnDef::new(Employees::VacationDaysPerYear)
                            .integer()
                            .not_null()
                            .default(30),
                    )
                    .col(
                        ColumnDef::new(Employees::VacationDaysRemaining)
                            .float()
                            .not_null()
                            .default(30.0),
                    )
                    .col(
                        ColumnDef::new(Employees::ShiftPreferences)
                            .json_binary()
                            .not_null()
                            .default(Expr::cust("'{}'::jsonb")),
                    )
                    .col(
                        ColumnDef::new(Employees::IsActive)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(Employees::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Employees::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_employees_tenant_id")
                            .from(Employees::Table, Employees::TenantId)
                            .to(Tenants::Table, Tenants::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Index on (tenant_id, is_active)
        manager
            .create_index(
                Index::create()
                    .name("idx_employees_tenant_active")
                    .table(Employees::Table)
                    .col(Employees::TenantId)
                    .col(Employees::IsActive)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Employees::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Employees {
    Table,
    Id,
    TenantId,
    FirstName,
    LastName,
    Email,
    Phone,
    WeeklyHours,
    MonthlyHours,
    YearlyHours,
    VacationDaysPerYear,
    VacationDaysRemaining,
    ShiftPreferences,
    IsActive,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Tenants {
    Table,
    Id,
}
