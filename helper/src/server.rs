//! The SSH server at the far end of the tunnel's forward. It offers what the
//! backend uses of a machine's sshd: a command or SFTP as this account, and a
//! connection to a port on this machine's loopback for previews. It refuses
//! the rest: shells, ptys, env, agent and X11 forwarding, any other forward.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use russh::keys::PublicKey;
use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId, ChannelOpenFailure, MethodKind, MethodSet};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tracing::{info, warn};

use crate::account::Account;
use crate::keys;
use crate::process;

// Where each system keeps the SFTP server its sshd runs.
const SFTP_SERVERS: &[&str] = &[
    "/usr/libexec/sftp-server",
    "/usr/lib/openssh/sftp-server",
    "/usr/libexec/openssh/sftp-server",
    "/usr/lib/ssh/sftp-server",
];

pub struct Machine {
    pub account: Account,
    pub sftp_server: Option<PathBuf>,
    config: Arc<server::Config>,
    authorized_keys: PathBuf,
}

impl Machine {
    pub fn load(dir: &Path) -> Result<Self> {
        let account = Account::current()?;
        let host_key = keys::own_key(&dir.join("host_key"))?;
        let authorized_keys = dir.join("authorized_keys");
        // Read now so a missing file fails the start, not every login after.
        keys::public_keys(&authorized_keys)?;
        let sftp_server = SFTP_SERVERS.iter().map(PathBuf::from).find(|p| p.is_file());
        if sftp_server.is_none() {
            warn!("No sftp-server on this machine; file transfer will be refused");
        }
        let config = server::Config {
            methods: MethodSet::from(&[MethodKind::PublicKey][..]),
            keys: vec![host_key],
            // The backend's one key either matches or does not; nothing is
            // gained by making it wait on a refusal.
            auth_rejection_time: Duration::from_millis(200),
            auth_rejection_time_initial: Some(Duration::ZERO),
            max_auth_attempts: 3,
            ..Default::default()
        };
        info!(account = %account.name, "Serving logins for this account");
        Ok(Self {
            account,
            sftp_server,
            config: Arc::new(config),
            authorized_keys,
        })
    }

    /// Serves one SSH connection arriving through the tunnel.
    pub async fn serve<S>(self: Arc<Self>, stream: S, peer: Peer) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let config = self.config.clone();
        let login = Login {
            machine: self,
            peer,
        };
        match server::run_stream(config, stream, login).await?.await {
            // The backend went away without a goodbye, as every login does
            // when the gateway drops its side of the dial.
            Err(e) if ended_quietly(&e) => Ok(()),
            other => other,
        }
    }

    fn admits(&self, user: &str, key: &PublicKey) -> bool {
        if user != self.account.name {
            return false;
        }
        // Read on every login, as sshd does, so a key the deployment rotates
        // in reaches a running helper.
        match keys::public_keys(&self.authorized_keys) {
            Ok(allowed) => keys::holds(&allowed, key),
            Err(e) => {
                warn!("Could not read the authorized keys: {e:#}");
                false
            }
        }
    }
}

/// Where a login came from, as `$SSH_CONNECTION` reports it.
#[derive(Clone)]
pub struct Peer {
    pub address: String,
    pub port: u32,
}

struct Login {
    machine: Arc<Machine>,
    peer: Peer,
}

fn refused() -> Auth {
    Auth::Reject {
        proceed_with_methods: None,
        partial_success: false,
    }
}

impl server::Handler for Login {
    type Error = anyhow::Error;

    async fn auth_publickey_offered(&mut self, user: &str, key: &PublicKey) -> Result<Auth> {
        Ok(if self.machine.admits(user, key) {
            Auth::Accept
        } else {
            refused()
        })
    }

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth> {
        Ok(if self.machine.admits(user, key) {
            Auth::Accept
        } else {
            refused()
        })
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        session: &mut Session,
    ) -> Result<()> {
        reply.accept().await;
        tokio::spawn(process::run(
            channel,
            session.handle(),
            self.machine.clone(),
            self.peer.clone(),
        ));
        Ok(())
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host: &str,
        port: u32,
        _: &str,
        _: u32,
        reply: server::ChannelOpenHandle,
        _: &mut Session,
    ) -> Result<()> {
        let Some(address) = loopback(host, port) else {
            return Ok(()); // dropping the reply refuses the channel
        };
        tokio::spawn(async move {
            match TcpStream::connect(address).await {
                Ok(mut tcp) => {
                    reply.accept().await;
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
                }
                Err(_) => reply.reject(ChannelOpenFailure::ConnectFailed).await,
            }
        });
        Ok(())
    }

    // The channel's own task starts what these ask for; here they are only
    // answered.
    async fn exec_request(&mut self, id: ChannelId, _: &[u8], session: &mut Session) -> Result<()> {
        session.channel_success(id)?;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<()> {
        if name == "sftp" && self.machine.sftp_server.is_some() {
            session.channel_success(id)?;
        } else {
            session.channel_failure(id)?;
        }
        Ok(())
    }

    async fn shell_request(&mut self, id: ChannelId, session: &mut Session) -> Result<()> {
        session.channel_failure(id)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        id: ChannelId,
        _: &str,
        _: u32,
        _: u32,
        _: u32,
        _: u32,
        _: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<()> {
        session.channel_failure(id)?;
        Ok(())
    }

    async fn env_request(
        &mut self,
        id: ChannelId,
        _: &str,
        _: &str,
        session: &mut Session,
    ) -> Result<()> {
        session.channel_failure(id)?;
        Ok(())
    }

    async fn x11_request(
        &mut self,
        id: ChannelId,
        _: bool,
        _: &str,
        _: &str,
        _: u32,
        session: &mut Session,
    ) -> Result<()> {
        session.channel_failure(id)?;
        Ok(())
    }
}

fn loopback(host: &str, port: u32) -> Option<SocketAddr> {
    let port = u16::try_from(port).ok()?;
    match host {
        "127.0.0.1" | "localhost" => Some((Ipv4Addr::LOCALHOST, port).into()),
        "::1" => Some((Ipv6Addr::LOCALHOST, port).into()),
        _ => None,
    }
}

fn ended_quietly(e: &anyhow::Error) -> bool {
    match e.downcast_ref::<russh::Error>() {
        Some(russh::Error::IO(io)) => io.kind() == std::io::ErrorKind::UnexpectedEof,
        Some(russh::Error::Disconnect | russh::Error::HUP) => true,
        _ => false,
    }
}
