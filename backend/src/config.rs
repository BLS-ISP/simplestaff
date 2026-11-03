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
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_user: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
    pub smtp_enabled: bool,
    pub app_base_url: String,
    pub allow_public_registration: bool,
}

impl Config {
    /// Load configuration from environment variables.
    ///
    /// Reads `.env` file first (if present) via `dotenvy`, then pulls each
    /// variable from the environment. Sensible defaults are provided for
    /// `SERVER_HOST` (0.0.0.0) and `SERVER_PORT` (8080).
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        let smtp_host = env::var("SMTP_HOST").ok().filter(|s| !s.trim().is_empty());
        let smtp_port = env::var("SMTP_PORT").ok().and_then(|p| p.parse::<u16>().ok());
        let smtp_user = env::var("SMTP_USER").ok().filter(|s| !s.trim().is_empty());
        let smtp_password = env::var("SMTP_PASSWORD").ok().filter(|s| !s.trim().is_empty());
        let smtp_from = env::var("SMTP_FROM").ok().filter(|s| !s.trim().is_empty());
        let smtp_enabled = env::var("SMTP_ENABLED")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1" || v.eq_ignore_ascii_case("yes"))
            .unwrap_or_else(|_| smtp_host.is_some());
        let app_base_url = env::var("APP_BASE_URL")
            .unwrap_or_else(|_| "https://time.bls-isp.net".to_string());
        let allow_public_registration = env::var("ALLOW_PUBLIC_REGISTRATION")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1" || v.eq_ignore_ascii_case("yes"))
            .unwrap_or(false);

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
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_password,
            smtp_from,
            smtp_enabled,
            app_base_url,
            allow_public_registration,
        }
    }
}
