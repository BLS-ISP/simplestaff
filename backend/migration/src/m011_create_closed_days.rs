use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ClosedDays::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ClosedDays::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(ColumnDef::new(ClosedDays::TenantId).uuid().not_null())
                    .col(ColumnDef::new(ClosedDays::ClosedDate).date().not_null())
                    .col(ColumnDef::new(ClosedDays::Description).string().not_null())
                    .col(
                        ColumnDef::new(ClosedDays::IsHoliday)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(ClosedDays::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ClosedDays::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_closed_days_tenant_id")
                            .from(ClosedDays::Table, ClosedDays::TenantId)
                            .to(Tenants::Table, Tenants::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // UNIQUE constraint on (tenant_id, closed_date)
        manager
            .create_index(
                Index::create()
                    .name("idx_closed_days_tenant_date_unique")
                    .table(ClosedDays::Table)
                    .col(ClosedDays::TenantId)
                    .col(ClosedDays::ClosedDate)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Enable Row-Level Security
        let db = manager.get_connection();
        let table = "closed_days";

        db.execute_unprepared(&format!(
            "ALTER TABLE \"{table}\" ENABLE ROW LEVEL SECURITY"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "ALTER TABLE \"{table}\" FORCE ROW LEVEL SECURITY"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_select\" ON \"{table}\" FOR SELECT USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_insert\" ON \"{table}\" FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_update\" ON \"{table}\" FOR UPDATE USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_delete\" ON \"{table}\" FOR DELETE USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)"
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let table = "closed_days";

        // Drop RLS policies
        for action in &["select", "insert", "update", "delete"] {
            let _ = db.execute_unprepared(&format!(
                "DROP POLICY IF EXISTS \"tenant_isolation_{table}_{action}\" ON \"{table}\""
            )).await;
        }

        manager
            .drop_table(Table::drop().table(ClosedDays::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ClosedDays {
    Table,
    Id,
    TenantId,
    ClosedDate,
    Description,
    IsHoliday,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Tenants {
    Table,
    Id,
}
