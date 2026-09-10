use reqwest::Client;
use std::time::Duration;

pub fn build() -> Result<Client, String> {
    let builder = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Eden Agent-Lichess-Worker/1")
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none());
    let builder = if let Some(socket) = std::env::var_os("MON_CONNECTOR_HTTPS_SOCKET") {
        #[cfg(unix)]
        {
            // reqwest retains TLS and certificate hostname validation over Unix sockets.
            builder.unix_socket(std::path::PathBuf::from(socket))
        }
        #[cfg(not(unix))]
        {
            let _ = socket;
            return Err("Lichess socket transport is unavailable on this platform".to_owned());
        }
    } else {
        builder
    };
    builder.build().map_err(|_| "Cannot construct Lichess HTTP client".to_owned())
}
