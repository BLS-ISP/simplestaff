use std::env;

/// Application configuration loaded from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub server_host: String,
    pub server_port: u16,
    pub super_admin_email: String,
    pub super_admin_password: String,
    pub super_admin_tenant_name: String,
    pub super_admin_tenant_slug: String,
}

impl Config {
    /// Load configuration from environment variables.
    ///
    /// Reads `.env` file first (if present) via `dotenvy`, then pulls each
    /// variable from the environment. Sensible defaults are provided for
    /// `SERVER_HOST` (0.0.0.0) and `SERVER_PORT` (8080).
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        Self {
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            jwt_secret: env::var("JWT_SECRET")
                .expect("JWT_SECRET must be set"),
            server_host: env::var("SERVER_HOST")
                .unwrap_or_else(|_| "0.0.0.0".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .expect("SERVER_PORT must be a valid u16"),
            super_admin_email: env::var("SUPER_ADMIN_EMAIL")
                .expect("SUPER_ADMIN_EMAIL must be set"),
            super_admin_password: env::var("SUPER_ADMIN_PASSWORD")
                .expect("SUPER_ADMIN_PASSWORD must be set"),
            super_admin_tenant_name: env::var("SUPER_ADMIN_TENANT_NAME")
                .expect("SUPER_ADMIN_TENANT_NAME must be set"),
            super_admin_tenant_slug: env::var("SUPER_ADMIN_TENANT_SLUG")
                .expect("SUPER_ADMIN_TENANT_SLUG must be set"),
        }
    }
}
