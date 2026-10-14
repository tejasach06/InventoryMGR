use sqlx::postgres::{PgConnection, PgPool, PgPoolOptions};
use sqlx::Executor;
use std::time::Duration;
const SCHEMA: &str = include_str!("../../migrations/0001_inventory_schema.sql");
const HEAD: &str = "0024";
pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
}
async fn execute_migration(connection: &mut PgConnection, sql: &'static str) -> Result<(), sqlx::Error> {
    let mut start = 0;
    let mut offset = 0;
    for line in sql.split_inclusive('\n') {
        if matches!(line.trim(), "BEGIN;" | "COMMIT;") {
            let batch = &sql[start..offset];
            if !batch.trim().is_empty() {
                (&mut *connection).execute(batch).await?;
            }
            (&mut *connection).execute(line).await?;
            start = offset + line.len();
        }
        offset += line.len();
    }
    let batch = &sql[start..];
    if !batch.trim().is_empty() {
        connection.execute(batch).await?;
    }
    Ok(())
}
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut connection = pool.acquire().await?;
    sqlx::query("SELECT pg_advisory_lock(734190242)")
        .execute(&mut *connection).await?;
    let result = async {
        let exists: bool = sqlx::query_scalar(
            "SELECT to_regclass('public.alembic_version') IS NOT NULL"
        ).fetch_one(&mut *connection).await?;
        if !exists {
            let nonempty: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')"
            ).fetch_one(&mut *connection).await?;
            if nonempty {
                return Err(sqlx::Error::Protocol("Database has tables but no recognized schema version".into()));
            }
            execute_migration(&mut connection, SCHEMA).await?;
        } else {
            let revision: String = sqlx::query_scalar("SELECT version_num FROM alembic_version")
                .fetch_one(&mut *connection).await?;
            if revision != HEAD {
                let marker = format!("-- Running upgrade {revision} -> ");
                let offset = SCHEMA.find(&marker).ok_or_else(|| sqlx::Error::Protocol(
                    format!("Unsupported database schema revision {revision}")
                ))?;
                (&mut *connection).execute("BEGIN;").await?;
                execute_migration(&mut connection, &SCHEMA[offset..]).await?;
            }
        }
        Ok(())
    }.await;
    if result.is_err() {
        let _ = sqlx::query("ROLLBACK").execute(&mut *connection).await;
    }
    let unlock = sqlx::query("SELECT pg_advisory_unlock(734190242)")
        .execute(&mut *connection).await;
    result?;
    unlock?;
    Ok(())
}
