//! User entity model.

use sea_orm::entity::prelude::*;
use sea_orm::{ConnectionTrait, Statement};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub username: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::tenant::Entity",
        from = "Column::TenantId",
        to = "super::tenant::Column::Id"
    )]
    Tenant,
}

impl Related<super::tenant::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tenant.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// Sanitizes an arbitrary string into lowercase `[a-z0-9._-]` characters suitable for usernames.
pub fn sanitize_username_part(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

/// Validates an explicit username provided by a user/admin.
pub fn validate_username_format(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.len() < 3 || trimmed.len() > 100 {
        return Err(AppError::BadRequest(
            "Der Benutzername muss zwischen 3 und 100 Zeichen lang sein.".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '@')
    {
        return Err(AppError::BadRequest(
            "Der Benutzername darf nur Buchstaben (a-z), Zahlen (0-9) sowie '.', '_', '-' enthalten."
                .to_string(),
        ));
    }
    Ok(trimmed)
}

/// Checks if a username is already taken globally (case-insensitive).
pub async fn is_username_taken<C: ConnectionTrait>(
    conn: &C,
    username: &str,
    exclude_user_id: Option<Uuid>,
) -> Result<bool, AppError> {
    let clean = username.trim();
    if clean.is_empty() {
        return Ok(false);
    }

    let stmt = if let Some(ex_id) = exclude_user_id {
        Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT id FROM "users" WHERE LOWER("username") = LOWER($1) AND "id" <> $2 LIMIT 1"#,
            [clean.to_string().into(), ex_id.into()],
        )
    } else {
        Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            r#"SELECT id FROM "users" WHERE LOWER("username") = LOWER($1) LIMIT 1"#,
            [clean.to_string().into()],
        )
    };

    let row = conn.query_one(stmt).await?;
    Ok(row.is_some())
}

/// Generates a globally unique username based on email/name hint and tenant slug.
pub async fn generate_unique_username<C: ConnectionTrait>(
    conn: &C,
    email_or_hint: &str,
    tenant_slug: &str,
    exclude_user_id: Option<Uuid>,
) -> Result<String, AppError> {
    let local_part = email_or_hint.split('@').next().unwrap_or("user");
    let clean_local = sanitize_username_part(local_part);
    let prefix = if clean_local.is_empty() {
        "user".to_string()
    } else {
        clean_local
    };

    let clean_slug = sanitize_username_part(tenant_slug);
    let base = if clean_slug.is_empty() {
        prefix
    } else {
        format!("{prefix}.{clean_slug}")
    };

    if !is_username_taken(conn, &base, exclude_user_id).await? {
        return Ok(base);
    }

    for suffix in 2..1000 {
        let candidate = format!("{base}-{suffix}");
        if !is_username_taken(conn, &candidate, exclude_user_id).await? {
            return Ok(candidate);
        }
    }

    Ok(format!("{base}-{}", Uuid::new_v4().simple()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_username_part() {
        assert_eq!(sanitize_username_part("  Max.Mustermann! "), "max.mustermann");
        assert_eq!(sanitize_username_part("..admin-1.."), "admin-1");
    }

    #[test]
    fn test_validate_username_format() {
        assert_eq!(
            validate_username_format("  Max.Hotel-Adler  ").unwrap(),
            "max.hotel-adler"
        );
        assert!(validate_username_format("ab").is_err());
        assert!(validate_username_format("invalid space").is_err());
    }
}

