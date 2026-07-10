use sea_orm::{ConnectionTrait, DatabaseTransaction, Statement, TransactionTrait};
use std::future::Future;
use std::pin::Pin;
use uuid::Uuid;

use crate::errors::AppError;

/// Set the PostgreSQL session variable `app.current_tenant` on the given
/// transaction so that Row-Level Security policies can filter by tenant.
pub async fn set_tenant_context(
    txn: &DatabaseTransaction,
    tenant_id: &Uuid,
) -> Result<(), AppError> {
    let sql = format!("SET LOCAL app.current_tenant = '{tenant_id}'");
    txn.execute(Statement::from_string(
        sea_orm::DatabaseBackend::Postgres,
        sql,
    ))
    .await?;
    Ok(())
}

/// Execute a closure within a transaction that has the tenant context set.
///
/// 1. Begins a new transaction.
/// 2. Sets `app.current_tenant` via `SET LOCAL`.
/// 3. Calls the provided closure with a reference to the transaction.
/// 4. Commits the transaction on success, rolls back on error.
pub async fn execute_with_tenant<F, T>(
    db: &sea_orm::DatabaseConnection,
    tenant_id: &Uuid,
    f: F,
) -> Result<T, AppError>
where
    F: for<'c> FnOnce(&'c DatabaseTransaction) -> Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'c>>,
{
    let txn = db.begin().await?;
    set_tenant_context(&txn, tenant_id).await?;

    let result = f(&txn).await?;

    txn.commit().await?;
    Ok(result)
}
