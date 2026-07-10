use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ShiftTypes::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ShiftTypes::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(ColumnDef::new(ShiftTypes::TenantId).uuid().not_null())
                    .col(ColumnDef::new(ShiftTypes::Name).string().not_null())
                    .col(ColumnDef::new(ShiftTypes::StartTime).time().not_null())
                    .col(ColumnDef::new(ShiftTypes::EndTime).time().not_null())
                    .col(
                        ColumnDef::new(ShiftTypes::BreakMinutes)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(ShiftTypes::Color)
                            .string()
                            .not_null()
                            .default("#3B82F6"),
                    )
                    .col(
                        ColumnDef::new(ShiftTypes::IsActive)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(ShiftTypes::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ShiftTypes::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_types_tenant_id")
                            .from(ShiftTypes::Table, ShiftTypes::TenantId)
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
                    .name("idx_shift_types_tenant_active")
                    .table(ShiftTypes::Table)
                    .col(ShiftTypes::TenantId)
                    .col(ShiftTypes::IsActive)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ShiftTypes::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ShiftTypes {
    Table,
    Id,
    TenantId,
    Name,
    StartTime,
    EndTime,
    BreakMinutes,
    Color,
    IsActive,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Tenants {
    Table,
    Id,
}
