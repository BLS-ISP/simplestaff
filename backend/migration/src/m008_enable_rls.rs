use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Tables that require Row-Level Security (all tenant-scoped tables).
const RLS_TABLES: &[&str] = &[
    "users",
    "shift_types",
    "employees",
    "employee_blocked_days",
    "employee_vacations",
    "shift_assignments",
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        for table in RLS_TABLES {
            // Enable RLS on the table
            db.execute_unprepared(&format!(
                "ALTER TABLE \"{table}\" ENABLE ROW LEVEL SECURITY"
            ))
            .await?;

            // Force RLS for table owner as well
            db.execute_unprepared(&format!(
                "ALTER TABLE \"{table}\" FORCE ROW LEVEL SECURITY"
            ))
            .await?;

            // Create SELECT policy
            db.execute_unprepared(&format!(
                "CREATE POLICY \"tenant_isolation_{table}_select\" ON \"{table}\" \
                 FOR SELECT \
                 USING (tenant_id = current_setting('app.current_tenant')::uuid)"
            ))
            .await?;

            // Create INSERT policy
            db.execute_unprepared(&format!(
                "CREATE POLICY \"tenant_isolation_{table}_insert\" ON \"{table}\" \
                 FOR INSERT \
                 WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid)"
            ))
            .await?;

            // Create UPDATE policy
            db.execute_unprepared(&format!(
                "CREATE POLICY \"tenant_isolation_{table}_update\" ON \"{table}\" \
                 FOR UPDATE \
                 USING (tenant_id = current_setting('app.current_tenant')::uuid) \
                 WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid)"
            ))
            .await?;

            // Create DELETE policy
            db.execute_unprepared(&format!(
                "CREATE POLICY \"tenant_isolation_{table}_delete\" ON \"{table}\" \
                 FOR DELETE \
                 USING (tenant_id = current_setting('app.current_tenant')::uuid)"
            ))
            .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        for table in RLS_TABLES {
            // Drop all policies for this table
            for action in &["select", "insert", "update", "delete"] {
                db.execute_unprepared(&format!(
                    "DROP POLICY IF EXISTS \"tenant_isolation_{table}_{action}\" ON \"{table}\""
                ))
                .await?;
            }

            // Disable RLS
            db.execute_unprepared(&format!(
                "ALTER TABLE \"{table}\" DISABLE ROW LEVEL SECURITY"
            ))
            .await?;
        }

        Ok(())
    }
}
