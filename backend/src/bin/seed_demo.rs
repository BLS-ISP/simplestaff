use sea_orm::{ConnectionTrait, Database, Statement};
use dotenvy::dotenv;
use std::env;
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHasher,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    
    let db = Database::connect(&database_url).await?;
    let backend = sea_orm::DatabaseBackend::Postgres;
    
    println!("Connected to database. Seeding demo user...");
    
    // 1. Get tenant_id from admin@test.local
    let admin_query = "SELECT tenant_id FROM users WHERE email = 'admin@test.local'";
    let admin_row = db.query_one(Statement::from_string(backend, admin_query)).await?;
    
    let tenant_id: uuid::Uuid = match admin_row {
        Some(row) => {
            row.try_get("", "tenant_id")?
        }
        None => {
            // Find any tenant in the database or fallback
            let fallback_query = "SELECT id FROM tenants LIMIT 1";
            let fallback_row = db.query_one(Statement::from_string(backend, fallback_query)).await?;
            match fallback_row {
                Some(row) => row.try_get("", "id")?,
                None => {
                    println!("Error: No tenant found in the database. Please create one or run migrations first.");
                    return Ok(());
                }
            }
        }
    };
    
    println!("Found tenant_id: {}", tenant_id);
    
    let now = chrono::Utc::now().to_rfc3339();
    
    // 2. Insert/Ensure employee 'peter@test.local' exists
    let emp_check = "SELECT id FROM employees WHERE email = 'peter@test.local'";
    let emp_row = db.query_one(Statement::from_string(backend, emp_check)).await?;
    
    let _employee_id: uuid::Uuid = match emp_row {
        Some(row) => {
            let eid: uuid::Uuid = row.try_get("", "id")?;
            println!("Employee peter@test.local already exists (id={})", eid);
            eid
        }
        None => {
            let new_eid = uuid::Uuid::new_v4();
            let insert_emp = format!(
                "INSERT INTO employees (id, tenant_id, first_name, last_name, email, weekly_hours, vacation_days_per_year, vacation_days_remaining, is_active, created_at, updated_at) \
                 VALUES ('{}', '{}', 'Peter', 'Ebert', 'peter@test.local', 40.0, 30, 30.0, true, '{}', '{}')",
                new_eid, tenant_id, now, now
            );
            db.execute(Statement::from_string(backend, insert_emp)).await?;
            println!("Created employee peter@test.local (id={})", new_eid);
            new_eid
        }
    };
    
    // 3. Insert/Ensure user 'peter@test.local' exists
    let user_check = "SELECT id FROM users WHERE email = 'peter@test.local'";
    let user_row = db.query_one(Statement::from_string(backend, user_check)).await?;
    
    // Hash password "start123"
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password("start123".as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    if user_row.is_some() {
        println!("User peter@test.local already exists. Updating password...");
        let update_user = format!(
            "UPDATE users SET password_hash = '{}' WHERE email = 'peter@test.local'",
            password_hash
        );
        db.execute(Statement::from_string(backend, update_user)).await?;
        println!("Password updated successfully.");
    } else {
        let new_uid = uuid::Uuid::new_v4();
        let insert_user = format!(
            "INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at) \
             VALUES ('{}', '{}', 'peter@test.local', '{}', 'Peter', 'Ebert', 'viewer', true, '{}', '{}')",
            new_uid, tenant_id, password_hash, now, now
        );
        db.execute(Statement::from_string(backend, insert_user)).await?;
        println!("Created user peter@test.local (id={})", new_uid);
    }
    
    println!("Seeding complete!");
    Ok(())
}
