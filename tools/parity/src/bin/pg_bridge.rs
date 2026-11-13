fn main() {
    let mut arguments = std::env::args();
    let executable = arguments.next().unwrap_or_default();
    let result = inventorymgr_parity::bridge::binary_name(&executable)
        .and_then(|binary| inventorymgr_parity::bridge::run(binary, &arguments.collect::<Vec<_>>()));
    match result {
        Ok(status) => {
            #[cfg(unix)]
            let code = {
                use std::os::unix::process::ExitStatusExt;
                status.code().unwrap_or_else(|| -status.signal().unwrap_or(1))
            };
            #[cfg(not(unix))]
            let code = status.code().unwrap_or(1);
            std::process::exit(code);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
