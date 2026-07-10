use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ShiftSwaps::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ShiftSwaps::Id)
                            .uuid()
                            .not_null()
                            .primary_key()
                            .default(Expr::cust("gen_random_uuid()")),
                    )
                    .col(ColumnDef::new(ShiftSwaps::TenantId).uuid().not_null())
                    .col(ColumnDef::new(ShiftSwaps::AssignmentId).uuid().not_null())
                    .col(ColumnDef::new(ShiftSwaps::RequestingEmployeeId).uuid().not_null())
                    .col(ColumnDef::new(ShiftSwaps::TargetEmployeeId).uuid())
                    .col(ColumnDef::new(ShiftSwaps::BackupEmployeeId).uuid())
                    .col(ColumnDef::new(ShiftSwaps::Status).string().not_null())
                    .col(ColumnDef::new(ShiftSwaps::Notes).string())
                    .col(
                        ColumnDef::new(ShiftSwaps::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(ShiftSwaps::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_swaps_tenant_id")
                            .from(ShiftSwaps::Table, ShiftSwaps::TenantId)
                            .to(Tenants::Table, Tenants::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_swaps_assignment_id")
                            .from(ShiftSwaps::Table, ShiftSwaps::AssignmentId)
                            .to(ShiftAssignments::Table, ShiftAssignments::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_swaps_requesting_employee_id")
                            .from(ShiftSwaps::Table, ShiftSwaps::RequestingEmployeeId)
                            .to(Employees::Table, Employees::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_swaps_target_employee_id")
                            .from(ShiftSwaps::Table, ShiftSwaps::TargetEmployeeId)
                            .to(Employees::Table, Employees::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_shift_swaps_backup_employee_id")
                            .from(ShiftSwaps::Table, ShiftSwaps::BackupEmployeeId)
                            .to(Employees::Table, Employees::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;

        // Enable Row-Level Security
        let db = manager.get_connection();
        let table = "shift_swaps";

        db.execute_unprepared(&format!(
            "ALTER TABLE \"{table}\" ENABLE ROW LEVEL SECURITY"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "ALTER TABLE \"{table}\" FORCE ROW LEVEL SECURITY"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_select\" ON \"{table}\" FOR SELECT USING (tenant_id = current_setting('app.current_tenant')::uuid)"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_insert\" ON \"{table}\" FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid)"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_update\" ON \"{table}\" FOR UPDATE USING (tenant_id = current_setting('app.current_tenant')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid)"
        ))
        .await?;

        db.execute_unprepared(&format!(
            "CREATE POLICY \"tenant_isolation_{table}_delete\" ON \"{table}\" FOR DELETE USING (tenant_id = current_setting('app.current_tenant')::uuid)"
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let table = "shift_swaps";

        // Drop RLS policies
        for action in &["select", "insert", "update", "delete"] {
            let _ = db.execute_unprepared(&format!(
                "DROP POLICY IF EXISTS \"tenant_isolation_{table}_{action}\" ON \"{table}\""
            )).await;
        }

        manager
            .drop_table(Table::drop().table(ShiftSwaps::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ShiftSwaps {
    Table,
    Id,
    TenantId,
    AssignmentId,
    RequestingEmployeeId,
    TargetEmployeeId,
    BackupEmployeeId,
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
enum ShiftAssignments {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Employees {
    Table,
    Id,
}
