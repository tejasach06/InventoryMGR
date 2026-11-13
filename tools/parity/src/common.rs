use std::collections::HashMap;
use std::fs::{self, File};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub type Result<T, E = Box<dyn std::error::Error + Send + Sync>> = std::result::Result<T, E>;
pub const PASSWORD: &str = "parity-only-correct-horse-battery";
pub const ZERO: &str = "00000000-0000-0000-0000-000000000001";
pub const POSTGRES_IMAGE: &str = "docker.io/library/postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27";

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

pub fn command(args: &[&str]) -> Result<String> {
    let (program, arguments) = args.split_first().ok_or("Missing command")?;
    let output = Command::new(program).args(arguments).output()?;
    if !output.status.success() {
        return Err(format!("{} exited {}: {}", args.join(" "), output.status, String::from_utf8_lossy(&output.stderr)).into());
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

pub fn token(bytes: usize) -> String {
    let mut result = String::new();
    while result.len() < bytes * 2 {
        result.push_str(&uuid::Uuid::new_v4().simple().to_string());
    }
    result.truncate(bytes * 2);
    result
}

pub fn free_port() -> Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

pub fn wait_ready(process: &mut Child, port: u16) -> Result<()> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(1)).build()?;
    for _ in 0..200 {
        if let Some(status) = process.try_wait()? {
            return Err(format!("Backend exited early with {status}").into());
        }
        if client.get(format!("http://127.0.0.1:{port}/api/health")).send().is_ok_and(|response| response.status() == 200) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Backend readiness timed out".into())
}

pub fn write_json(path: impl AsRef<Path>, value: &serde_json::Value) -> Result<()> {
    fs::write(path, format!("{}\n", serde_json::to_string_pretty(value)?))?;
    Ok(())
}

pub struct Container {
    pub name: String,
    pub port: u16,
}

impl Container {
    pub fn start() -> Result<Self> {
        Self::start_with_image(POSTGRES_IMAGE)
    }

    pub fn start_with_image(image: &str) -> Result<Self> {
        let mut owned = Self { name: format!("inventorymgr-rust-parity-{}", token(6)), port: 0 };
        command(&["podman", "run", "--detach", "--name", &owned.name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", image])?;
        let published = command(&["podman", "port", &owned.name, "5432/tcp"])?;
        owned.port = published.rsplit(':').next().ok_or("Missing PostgreSQL port")?.parse()?;
        for _ in 0..100 {
            if Command::new("podman").args(["exec", &owned.name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]).stdout(Stdio::null()).stderr(Stdio::null()).status()?.success() {
                return Ok(owned);
            }
            thread::sleep(Duration::from_millis(200));
        }
        Err("Disposable PostgreSQL readiness timed out".into())
    }

    pub fn sql(&self, db: &str, text: &str) -> Result<String> {
        command(&["podman", "exec", &self.name, "psql", "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", text])
    }

    pub fn create_db(&self, db: &str) -> Result<()> {
        command(&["podman", "exec", &self.name, "createdb", "-U", "postgres", db])?;
        Ok(())
    }

    pub fn url(&self, db: &str) -> String {
        format!("postgresql://postgres@127.0.0.1:{}/{db}", self.port)
    }

    pub fn internal_url(&self, db: &str) -> String {
        format!("postgresql://postgres@127.0.0.1:5432/{db}")
    }

    pub fn env(&self, db: &str, port: u16, backup: &Path) -> HashMap<String, String> {
        HashMap::from([
            ("APP_ENV".into(), "test".into()),
            ("DATABASE_URL".into(), self.url(db)),
            ("JWT_SECRET".into(), token(32)),
            ("HOST".into(), "127.0.0.1".into()),
            ("PORT".into(), port.to_string()),
            ("BIND_ADDR".into(), format!("127.0.0.1:{port}")),
            ("BACKUP_DIR".into(), backup.to_string_lossy().into_owned()),
        ])
    }
}

impl Drop for Container {
    fn drop(&mut self) {
        let _ = Command::new("podman").args(["rm", "-f", &self.name]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

pub struct Process(pub Child);

impl Process {
    pub fn spawn(binary: &Path, env: &HashMap<String, String>, log: &Path) -> Result<Self> {
        let output = File::create(log)?;
        Ok(Self(Command::new(binary).envs(env).current_dir(root()).stdout(output.try_clone()?).stderr(output).spawn()?))
    }

    pub fn terminate(&mut self) -> Result<()> {
        if self.0.try_wait()?.is_some() {
            return Ok(());
        }
        #[cfg(unix)]
        {
            let status = Command::new("kill").args(["-TERM", &self.0.id().to_string()]).status()?;
            if !status.success() && self.0.try_wait()?.is_none() {
                return Err("Could not terminate backend".into());
            }
        }
        #[cfg(not(unix))]
        self.0.kill()?;
        Ok(())
    }

    pub fn wait(&mut self, timeout: Duration) -> Result<ExitStatus> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.0.try_wait()? {
                return Ok(status);
            }
            if Instant::now() >= deadline {
                return Err("Backend shutdown timed out".into());
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    pub fn stop(&mut self) -> Result<ExitStatus> {
        self.terminate()?;
        self.wait(Duration::from_secs(20))
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        if self.stop().is_err() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new(parent: &Path, prefix: &str) -> Result<Self> {
        fs::create_dir_all(parent)?;
        let directory = parent.join(format!("{prefix}{}", token(8)));
        fs::create_dir(&directory)?;
        Ok(Self(directory))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn install_bridge(directory: &Path) -> Result<()> {
    fs::create_dir_all(directory)?;
    let executable = std::env::current_exe()?;
    let bridge = executable.with_file_name(format!("pg-bridge{}", std::env::consts::EXE_SUFFIX));
    for name in ["pg_dump", "pg_restore"] {
        let destination = directory.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
        fs::copy(&bridge, &destination)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(destination, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}
