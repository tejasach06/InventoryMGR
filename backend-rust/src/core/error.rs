#[derive(Debug)]
pub enum Error {
    Invalid(String),
    Internal(String),
}

impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.to_string())
    }
}
