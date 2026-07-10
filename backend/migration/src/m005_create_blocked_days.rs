use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(EmployeeBlockedDays::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(EmployeeBlockedDays::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(
                        ColumnDef::new(EmployeeBlockedDays::TenantId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EmployeeBlockedDays::EmployeeId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EmployeeBlockedDays::BlockedDate)
                            .date()
                            .not_null(),
                    )
                    .col(ColumnDef::new(EmployeeBlockedDays::Reason).string())
                    .col(
                        ColumnDef::new(EmployeeBlockedDays::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_blocked_days_tenant_id")
                            .from(EmployeeBlockedDays::Table, EmployeeBlockedDays::TenantId)
                            .to(Tenants::Table, Tenants::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_blocked_days_employee_id")
                            .from(EmployeeBlockedDays::Table, EmployeeBlockedDays::EmployeeId)
                            .to(Employees::Table, Employees::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // UNIQUE constraint on (employee_id, blocked_date)
        manager
            .create_index(
                Index::create()
                    .name("idx_blocked_days_employee_date_unique")
                    .table(EmployeeBlockedDays::Table)
                    .col(EmployeeBlockedDays::EmployeeId)
                    .col(EmployeeBlockedDays::BlockedDate)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Index on (tenant_id, employee_id)
        manager
            .create_index(
                Index::create()
                    .name("idx_blocked_days_tenant_employee")
                    .table(EmployeeBlockedDays::Table)
                    .col(EmployeeBlockedDays::TenantId)
                    .col(EmployeeBlockedDays::EmployeeId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(EmployeeBlockedDays::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum EmployeeBlockedDays {
    Table,
    Id,
    TenantId,
    EmployeeId,
    BlockedDate,
    Reason,
    CreatedAt,
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
