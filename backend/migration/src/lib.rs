pub use sea_orm_migration::prelude::*;

mod m001_create_tenants;
mod m002_create_users;
mod m003_create_shift_types;
mod m004_create_employees;
mod m005_create_blocked_days;
mod m006_create_vacations;
mod m007_create_shift_assignments;
mod m008_enable_rls;
mod m009_add_valid_days_to_shift_types;
mod m010_add_min_max_staff_to_shift_types;
mod m011_create_closed_days;
mod m012_add_holiday_mode_to_shift_types;
mod m013_create_shift_swaps;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m001_create_tenants::Migration),
            Box::new(m002_create_users::Migration),
            Box::new(m003_create_shift_types::Migration),
            Box::new(m004_create_employees::Migration),
            Box::new(m005_create_blocked_days::Migration),
            Box::new(m006_create_vacations::Migration),
            Box::new(m007_create_shift_assignments::Migration),
            Box::new(m008_enable_rls::Migration),
            Box::new(m009_add_valid_days_to_shift_types::Migration),
            Box::new(m010_add_min_max_staff_to_shift_types::Migration),
            Box::new(m011_create_closed_days::Migration),
            Box::new(m012_add_holiday_mode_to_shift_types::Migration),
            Box::new(m013_create_shift_swaps::Migration),
        ]
    }
}
