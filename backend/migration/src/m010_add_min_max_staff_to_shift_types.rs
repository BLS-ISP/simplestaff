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
                    .add_column(ColumnDef::new(ShiftTypes::MinStaff).integer().null())
                    .add_column(ColumnDef::new(ShiftTypes::MaxStaff).integer().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ShiftTypes::Table)
                    .drop_column(ShiftTypes::MinStaff)
                    .drop_column(ShiftTypes::MaxStaff)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ShiftTypes {
    Table,
    MinStaff,
    MaxStaff,
}
