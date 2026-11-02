mod config;
mod errors;
mod handlers;
mod middleware;
mod models;
mod services;

use std::sync::Arc;

use axum::Router;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use sea_orm_migration::MigratorTrait;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use config::Config;

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

/// Shared state accessible from all handlers via Axum's `State` extractor.
#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub config: Arc<Config>,
}




// ---------------------------------------------------------------------------
// Super-admin seeding
// ---------------------------------------------------------------------------

/// Ensure the system tenant and super-admin user exist, and keep the
/// super-admin credentials synchronized with the environment configuration
/// (e.g. when updated via NethServer 8 Cockpit settings).
///
/// This runs raw SQL intentionally so that it bypasses Row-Level Security
/// policies (which require a tenant context that doesn't exist yet on first
/// boot).
async fn seed_super_admin(db: &DatabaseConnection, config: &Config) -> Result<(), errors::AppError> {
    use argon2::{
        password_hash::{rand_core::OsRng, SaltString},
        Argon2, PasswordHasher,
    };
    use sea_orm::Value;

    let backend = sea_orm::DatabaseBackend::Postgres;

    // Hash the configured super-admin password with Argon2.
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(config.super_admin_password.as_bytes(), &salt)
        .map_err(|e| errors::AppError::InternalError(format!("Password hashing failed: {e}")))?
        .to_string();

    let now = chrono::Utc::now();

    // Check if a super_admin user already exists (either by email or by role).
    let existing = db
        .query_one(Statement::from_sql_and_values(
            backend,
            "SELECT id FROM users WHERE email = $1 OR role = 'super_admin' ORDER BY created_at ASC LIMIT 1",
            [Value::from(config.super_admin_email.clone())],
        ))
        .await?;

    if let Some(row) = existing {
        let existing_id: uuid::Uuid = row.try_get("", "id")?;

        // Synchronize email and password_hash so credential changes in NS8 Settings take effect.
        db.execute(Statement::from_sql_and_values(
            backend,
            "UPDATE users SET email = $1, password_hash = $2, is_active = true, updated_at = $3 WHERE id = $4",
            [
                Value::from(config.super_admin_email.clone()),
                Value::from(password_hash),
                Value::from(now),
                Value::from(existing_id),
            ],
        ))
        .await?;

        tracing::info!(
            "Super admin already exists (user_id={existing_id}) – synchronized email and password from configuration."
        );
        return Ok(());
    }

    tracing::info!("Seeding system tenant and super admin user …");

    let tenant_id = uuid::Uuid::new_v4();
    let user_id = uuid::Uuid::new_v4();

    // Insert system tenant (or reuse if slug already exists).
    let existing_tenant = db
        .query_one(Statement::from_sql_and_values(
            backend,
            "SELECT id FROM tenants WHERE slug = $1 LIMIT 1",
            [Value::from(config.super_admin_tenant_slug.clone())],
        ))
        .await?;

    let effective_tenant_id = if let Some(t_row) = existing_tenant {
        t_row.try_get("", "id")?
    } else {
        db.execute(Statement::from_sql_and_values(
            backend,
            "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
            [
                Value::from(tenant_id),
                Value::from(config.super_admin_tenant_name.clone()),
                Value::from(config.super_admin_tenant_slug.clone()),
                Value::from(now),
                Value::from(now),
            ],
        ))
        .await?;
        tenant_id
    };

    // Insert super admin user.
    db.execute(Statement::from_sql_and_values(
        backend,
        "INSERT INTO users (id, tenant_id, email, password_hash, role, first_name, last_name, is_active, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, 'super_admin', 'Super', 'Admin', true, $5, $6)",
        [
            Value::from(user_id),
            Value::from(effective_tenant_id),
            Value::from(config.super_admin_email.clone()),
            Value::from(password_hash),
            Value::from(now),
            Value::from(now),
        ],
    ))
    .await?;

    tracing::info!("Super admin seeded successfully (user_id={user_id}).");
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    // Load configuration.
    let config = Config::from_env();

    // Initialize tracing / logging.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if config.smtp_enabled {
        tracing::info!(
            "SMTP email notifications ENABLED: host='{}:{}', from='{}'",
            config.smtp_host.as_deref().unwrap_or("<none>"),
            config.smtp_port.unwrap_or(587),
            config.smtp_from.as_deref().unwrap_or("<none>")
        );
    } else {
        tracing::info!("SMTP email notifications DISABLED in configuration.");
    }

    // Connect to the database with retry backoff (handles Podman pod startup ordering).
    let max_retries = 30;
    let mut attempt = 0;
    let db: DatabaseConnection = loop {
        attempt += 1;
        match Database::connect(&config.database_url).await {
            Ok(conn) => break conn,
            Err(e) if attempt < max_retries => {
                tracing::warn!(
                    "Database connection attempt {attempt}/{max_retries} failed ({e}) – retrying in 2s…"
                );
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            Err(e) => {
                panic!("Failed to connect to database after {max_retries} attempts: {e}");
            }
        }
    };

    tracing::info!("Connected to database.");

    // Run pending migrations.
    migration::Migrator::up(&db, None)
        .await
        .expect("Failed to run database migrations");

    tracing::info!("Migrations applied.");

    // Seed the super admin if it doesn't exist yet.
    if let Err(e) = seed_super_admin(&db, &config).await {
        tracing::error!("Failed to seed super admin: {e}");
    }

    // Build shared state.
    let state = AppState {
        db,
        config: Arc::new(config),
    };

    let host = state.config.server_host.clone();
    let port = state.config.server_port;

    // Build the application router.
    let app = Router::new()
        .nest("/api", handlers::api_router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start the server.
    let addr = format!("{host}:{port}");
    tracing::info!("SimpleStaff backend listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}
