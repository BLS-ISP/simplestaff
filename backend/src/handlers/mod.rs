pub mod admin;
pub mod assignments;
pub mod auth;
pub mod blocked_days;
pub mod calendar;
pub mod employees;
pub mod shift_types;
pub mod tenants;
pub mod vacations;
pub mod validation;
pub mod closed_days;
pub mod shift_swaps;

use axum::{routing::{get, put, delete}, Router};

use crate::AppState;

/// Build the top-level API router that nests all domain-specific sub-routers.
pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/auth", auth::router())
        .nest("/admin", admin::router())
        .nest("/tenants", tenants::router())
        .nest("/employees", employees::router())
        .nest("/shift-types", shift_types::router())
        .nest("/assignments", assignments::router())
        .nest("/calendar", calendar::router())
        .nest("/closed-days", closed_days::router())
        .route("/vacations", get(vacations::list_tenant_vacations))
        .route("/shift-swaps", get(shift_swaps::list_shift_swaps).post(shift_swaps::create_shift_swap))
        .route("/shift-swaps/", get(shift_swaps::list_shift_swaps).post(shift_swaps::create_shift_swap))
        .route("/shift-swaps/{id}/claim", put(shift_swaps::claim_shift_swap))
        .route("/shift-swaps/{id}/approve", put(shift_swaps::approve_shift_swap))
        .route("/shift-swaps/{id}/reject", put(shift_swaps::reject_shift_swap))
        .route("/shift-swaps/{id}", delete(shift_swaps::delete_shift_swap))
        .merge(validation::router())
}
