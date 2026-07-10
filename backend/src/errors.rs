use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

// ---------------------------------------------------------------------------
// Warning types (used for soft-validation responses)
// ---------------------------------------------------------------------------

/// Severity level for a validation warning.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WarningSeverity {
    Info,
    Warning,
    Critical,
}

/// A single validation warning returned to the client.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationWarning {
    pub code: String,
    pub message_de: String,
    pub message_en: String,
    pub severity: WarningSeverity,
}

// ---------------------------------------------------------------------------
// Central application error
// ---------------------------------------------------------------------------

/// Unified error type used across the application.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Internal error: {0}")]
    InternalError(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] sea_orm::DbErr),

    #[error("Validation warnings")]
    ValidationWarnings(Vec<ValidationWarning>),
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    kind: String,
    message: String,
}

#[derive(Serialize)]
struct WarningsBody {
    warnings: Vec<ValidationWarning>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::ValidationWarnings(warnings) => {
                let body = WarningsBody { warnings };
                (StatusCode::OK, axum::Json(body)).into_response()
            }
            other => {
                // Log the error depending on its type
                match &other {
                    AppError::InternalError(msg) => {
                        tracing::error!("Internal server error: {msg}");
                    }
                    AppError::DatabaseError(err) => {
                        tracing::error!("Database error: {err}");
                    }
                    AppError::NotFound(msg) => {
                        tracing::info!("Resource not found: {msg}");
                    }
                    AppError::BadRequest(msg) => {
                        tracing::warn!("Bad request: {msg}");
                    }
                    AppError::Unauthorized(msg) => {
                        tracing::warn!("Unauthorized access attempt: {msg}");
                    }
                    AppError::Forbidden(msg) => {
                        tracing::warn!("Forbidden access: {msg}");
                    }
                    AppError::Conflict(msg) => {
                        tracing::warn!("Conflict error: {msg}");
                    }
                    AppError::ValidationWarnings(_) => unreachable!(),
                }

                let (status, kind) = match &other {
                    AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
                    AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
                    AppError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
                    AppError::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
                    AppError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
                    AppError::InternalError(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
                    }
                    AppError::DatabaseError(_) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, "database_error")
                    }
                    AppError::ValidationWarnings(_) => unreachable!(),
                };

                let body = ErrorBody {
                    error: ErrorDetail {
                        kind: kind.to_string(),
                        message: other.to_string(),
                    },
                };

                (status, axum::Json(body)).into_response()
            }
        }
    }
}
