use tokio::io::{AsyncRead, AsyncWrite};

pub trait AdminTransport: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AdminTransport for T {}
pub type Stream = Box<dyn AdminTransport>;

pub async fn connect(host: &str, port: u16) -> Result<Stream, String> {
    if let Some(socket) = std::env::var_os("MON_CONNECTOR_ADMIN_SOCKET") {
        #[cfg(unix)]
        {
            return tokio::net::UnixStream::connect(socket)
                .await
                .map(|stream| Box::new(stream) as Stream)
                .map_err(|_| "OpenTTD approved Admin bridge is unavailable".to_owned());
        }
        #[cfg(not(unix))]
        {
            let _ = socket;
            return Err("OpenTTD Admin socket transport is unavailable on this platform".to_owned());
        }
    }
    tokio::net::TcpStream::connect((host, port))
        .await
        .map(|stream| Box::new(stream) as Stream)
        .map_err(|error| format!("OpenTTD Admin connection failed: {error}"))
}
