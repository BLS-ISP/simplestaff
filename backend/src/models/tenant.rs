//! Tenant entity model.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "tenants")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    #[sea_orm(unique)]
    pub slug: String,
    #[sea_orm(column_type = "JsonBinary")]
    pub settings: serde_json::Value,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::user::Entity")]
    Users,
    #[sea_orm(has_many = "super::employee::Entity")]
    Employees,
    #[sea_orm(has_many = "super::shift_type::Entity")]
    ShiftTypes,
    #[sea_orm(has_many = "super::shift_assignment::Entity")]
    ShiftAssignments,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Users.def()
    }
}

impl Related<super::employee::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Employees.def()
    }
}

impl Related<super::shift_type::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ShiftTypes.def()
    }
}

impl Related<super::shift_assignment::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ShiftAssignments.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// Checks if a tenant's license is active and not suspended.
pub fn check_tenant_license_active(
    settings: &serde_json::Value,
) -> Result<(), crate::errors::AppError> {
    use crate::errors::AppError;

    let is_suspended = settings
        .get("is_suspended")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if is_suspended {
        let reason = settings
            .get("suspension_reason")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());

        let msg = if let Some(r) = reason {
            format!("Dieser Mandant ist derzeit gesperrt ({r}). Bitte wenden Sie sich an BLS.ISP.")
        } else {
            "Dieser Mandant ist derzeit gesperrt. Bitte wenden Sie sich an BLS.ISP.".to_string()
        };
        return Err(AppError::Forbidden(msg));
    }

    if let Some(exp_str) = settings
        .get("license_expires_at")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        if let Ok(exp_date) = chrono::NaiveDate::parse_from_str(exp_str, "%Y-%m-%d") {
            let today = chrono::Utc::now().date_naive();
            if exp_date < today {
                return Err(AppError::Forbidden(format!(
                    "Die Lizenz für diesen Mandanten ist am {} abgelaufen. Bitte wenden Sie sich an BLS.ISP.",
                    exp_date.format("%d.%m.%Y")
                )));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_check_tenant_license_active() {
        // Default empty settings -> active
        assert!(check_tenant_license_active(&json!({})).is_ok());

        // Suspended without reason -> error
        let res = check_tenant_license_active(&json!({ "is_suspended": true }));
        assert!(res.is_err());

        // Suspended with reason -> error contains reason
        let res = check_tenant_license_active(&json!({
            "is_suspended": true,
            "suspension_reason": "Zahlungsverzug"
        }));
        assert!(format!("{:?}", res).contains("Zahlungsverzug"));

        // Expired license -> error
        let res = check_tenant_license_active(&json!({
            "license_expires_at": "2020-01-01"
        }));
        assert!(res.is_err());

        // Future license -> ok
        let res = check_tenant_license_active(&json!({
            "license_expires_at": "2099-12-31"
        }));
        assert!(res.is_ok());
    }
}


