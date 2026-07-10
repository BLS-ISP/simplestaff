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

/// Ensure the system tenant and super-admin user exist.
///
/// This runs raw SQL intentionally so that it bypasses Row-Level Security
/// policies (which require a tenant context that doesn't exist yet on first
/// boot).
async fn seed_super_admin(db: &DatabaseConnection, config: &Config) -> Result<(), errors::AppError> {
    use argon2::{
        password_hash::{rand_core::OsRng, SaltString},
        Argon2, PasswordHasher,
    };

    let backend = sea_orm::DatabaseBackend::Postgres;

    // Check if the super admin already exists.
    let check_sql = format!(
        "SELECT id FROM users WHERE email = '{}'",
        config.super_admin_email
    );
    let existing = db
        .query_one(Statement::from_string(backend, check_sql))
        .await?;

    if existing.is_some() {
        tracing::info!("Super admin already exists – skipping seed.");
        return Ok(());
    }

    tracing::info!("Seeding system tenant and super admin user …");

    let tenant_id = uuid::Uuid::new_v4();
    let user_id = uuid::Uuid::new_v4();
    let now = chrono::Utc::now().to_rfc3339();

    // Hash the password with Argon2.
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(config.super_admin_password.as_bytes(), &salt)
        .map_err(|e| errors::AppError::InternalError(format!("Password hashing failed: {e}")))?
        .to_string();

    // Insert system tenant.
    let insert_tenant = format!(
        "INSERT INTO tenants (id, name, slug, created_at, updated_at) \
         VALUES ('{tenant_id}', '{name}', '{slug}', '{now}', '{now}')",
        name = config.super_admin_tenant_name,
        slug = config.super_admin_tenant_slug,
    );
    db.execute(Statement::from_string(backend, insert_tenant))
        .await?;

    // Insert super admin user.
    let insert_user = format!(
        "INSERT INTO users (id, tenant_id, email, password_hash, role, first_name, last_name, is_active, created_at, updated_at) \
         VALUES ('{user_id}', '{tenant_id}', '{email}', '{password_hash}', 'super_admin', 'Super', 'Admin', true, '{now}', '{now}')",
        email = config.super_admin_email,
    );
    db.execute(Statement::from_string(backend, insert_user))
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

    // Connect to the database.
    let db: DatabaseConnection = Database::connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

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
