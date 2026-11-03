use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // 1. Add `username` column to `users`
        db.execute_unprepared(
            r#"ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" VARCHAR(100) NULL"#,
        )
        .await?;

        // 2. Add `user_id` column to `employees` referencing `users(id)`
        db.execute_unprepared(
            r#"ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "user_id" UUID NULL REFERENCES "users"("id") ON DELETE SET NULL"#,
        )
        .await?;

        // Temporarily disable RLS during backfill so updates see all rows even under non-superuser roles
        db.execute_unprepared(r#"ALTER TABLE "users" DISABLE ROW LEVEL SECURITY"#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE "employees" DISABLE ROW LEVEL SECURITY"#)
            .await?;

        // 3. Backfill `users.username` for existing users that don't have one yet
        db.execute_unprepared(
            r#"
            WITH ranked AS (
                SELECT
                    u.id,
                    CASE
                        WHEN u.role = 'super_admin' THEN 'superadmin'
                        ELSE LOWER(
                            COALESCE(
                                NULLIF(REGEXP_REPLACE(SPLIT_PART(u.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g'), ''),
                                'user'
                            ) || '.' || t.slug
                        )
                    END AS base_username,
                    ROW_NUMBER() OVER (
                        PARTITION BY
                            CASE
                                WHEN u.role = 'super_admin' THEN 'superadmin'
                                ELSE LOWER(
                                    COALESCE(
                                        NULLIF(REGEXP_REPLACE(SPLIT_PART(u.email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g'), ''),
                                        'user'
                                    ) || '.' || t.slug
                                )
                            END
                        ORDER BY u.created_at ASC, u.id ASC
                    ) AS rn
                FROM "users" u
                JOIN "tenants" t ON t.id = u.tenant_id
                WHERE u.username IS NULL OR BTRIM(u.username) = ''
            )
            UPDATE "users" u
            SET username = CASE
                WHEN r.rn = 1 THEN r.base_username
                ELSE r.base_username || '-' || r.rn::text
            END
            FROM ranked r
            WHERE u.id = r.id
            "#,
        )
        .await?;

        // 4. Backfill `employees.user_id` by matching email within the same tenant
        db.execute_unprepared(
            r#"
            UPDATE "employees" e
            SET user_id = u.id
            FROM "users" u
            WHERE e.tenant_id = u.tenant_id
              AND e.user_id IS NULL
              AND e.id = (
                  SELECT e2.id
                  FROM "employees" e2
                  WHERE e2.tenant_id = u.tenant_id
                    AND e2.user_id IS NULL
                    AND e2.email IS NOT NULL
                    AND LOWER(BTRIM(e2.email)) = LOWER(BTRIM(u.email))
                  ORDER BY e2.created_at ASC, e2.id ASC
                  LIMIT 1
              )
            "#,
        )
        .await?;

        // Re-enable RLS
        db.execute_unprepared(r#"ALTER TABLE "users" ENABLE ROW LEVEL SECURITY"#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY"#)
            .await?;

        // 5. Create unique indexes
        db.execute_unprepared(
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username_unique" ON "users" (LOWER("username")) WHERE "username" IS NOT NULL AND BTRIM("username") <> ''"#,
        )
        .await?;

        db.execute_unprepared(
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "idx_employees_tenant_user_unique" ON "employees" ("tenant_id", "user_id") WHERE "user_id" IS NOT NULL"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(r#"DROP INDEX IF EXISTS "idx_employees_tenant_user_unique""#)
            .await?;
        db.execute_unprepared(r#"DROP INDEX IF EXISTS "idx_users_username_unique""#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE "employees" DROP COLUMN IF EXISTS "user_id""#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE "users" DROP COLUMN IF EXISTS "username""#)
            .await?;

        Ok(())
    }
}
