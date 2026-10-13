use std::env;
#[derive(Clone, Debug)]
pub struct Settings {
    pub app_env: String,
    pub database_url: String,
    pub test_database_url: String,
    pub jwt_secret: String,
    pub session_cookie_name: String,
    pub csrf_cookie_name: String,
    pub secure_cookies: bool,
    pub cors_origins: Vec<String>,
    pub backup_dir: String,
    pub pg_bin_dir: String,
    pub host: String,
    pub port: u16,
}
impl Settings {
    pub fn from_env() -> Self {
        dotenvy::from_filename("../.env").ok();
        dotenvy::dotenv().ok();
        let get = |key: &str, default: &str| env::var(key).unwrap_or_else(|_| default.to_owned());
        let app_env = get("APP_ENV", "development");
        let jwt_secret = get("JWT_SECRET", "replace-with-32-byte-random-secret");
        if !matches!(app_env.as_str(), "development" | "test")
            && (jwt_secret.is_empty() || jwt_secret == "replace-with-32-byte-random-secret")
        {
            panic!("JWT_SECRET must be set to a strong random value in production");
        }
        Self {
            secure_cookies: app_env == "production",
            app_env,
            database_url: get(
                "DATABASE_URL",
                "postgresql://inventorymgr@127.0.0.1:54329/inventorymgr",
            )
            .replace("postgresql+psycopg://", "postgresql://"),
            test_database_url: get(
                "TEST_DATABASE_URL",
                "postgresql://inventorymgr@127.0.0.1:54329/inventorymgr_test",
            )
            .replace("postgresql+psycopg://", "postgresql://"),
            jwt_secret,
            session_cookie_name: get("SESSION_COOKIE_NAME", "inventorymgr_session"),
            csrf_cookie_name: get("CSRF_COOKIE_NAME", "inventorymgr_csrf"),
            cors_origins: get(
                "APP_CORS_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            )
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect(),
            backup_dir: get("BACKUP_DIR", "./backups"),
            pg_bin_dir: get("PG_BIN_DIR", ""),
            host: get("HOST", "0.0.0.0"),
            port: get("PORT", "8000").parse().unwrap_or(8000),
        }
    }
}
