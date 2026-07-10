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
                        ColumnDef::new(ShiftTypes::HolidayMode)
                            .string()
                            .not_null()
                            .default("any_day"),
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
                    .drop_column(ShiftTypes::HolidayMode)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ShiftTypes {
    Table,
    HolidayMode,
}
