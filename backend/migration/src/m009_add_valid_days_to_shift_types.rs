use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ShiftTypes::Table)
                    .add_column(
                        ColumnDef::new(ShiftTypes::ValidDays)
                            .json_binary()
                            .not_null()
                            .default(Expr::cust("'[1, 2, 3, 4, 5, 6, 7]'::jsonb")),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ShiftTypes::Table)
                    .drop_column(ShiftTypes::ValidDays)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ShiftTypes {
    Table,
    ValidDays,
}
