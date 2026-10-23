//! The tunnel: one login to the gateway holding a `langalpha:22` forward, made
//! again whenever it drops, with the waits `tunnel.sh`'s loop keeps.

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use russh::Channel;
use russh::client::{self, ChannelOpenHandle};
use russh::keys::{PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use tracing::{info, warn};

use crate::keys;
use crate::server::{Machine, Peer};

pub const TUNNEL_FILE: &str = "tunnel";

// The forward the gateway expects, the one `ssh -R langalpha:22:...` asks for.
const FORWARD_HOST: &str = "langalpha";
const FORWARD_PORT: u32 = 22;

pub struct Gateway {
    host: String,
    port: u16,
    login: String,
    key: Arc<PrivateKey>,
    pins: Arc<Vec<PublicKey>>,
}

impl Gateway {
    /// The tunnel the folder holds, as pairing left it: `tunnel` with the
    /// deployment's answer (`tunnel_id=`, `gateway_host=`, `gateway_port=`),
    /// `known_hosts` with the gateway's pinned key, `id_ed25519` the tunnel's.
    pub fn load(dir: &Path) -> Result<Self> {
        let answer = fs::read_to_string(dir.join(TUNNEL_FILE))
            .context("this folder holds no tunnel; pair the machine first")?;
        let field = |name: &str| {
            answer
                .lines()
                .find_map(|line| line.strip_prefix(name)?.strip_prefix('='))
                .with_context(|| format!("{TUNNEL_FILE} names no {name}"))
        };
        let pins = keys::public_keys(&dir.join("known_hosts"))?;
        if pins.is_empty() {
            bail!("known_hosts pins no key for the gateway");
        }
        Ok(Self {
            host: field("gateway_host")?.to_string(),
            port: field("gateway_port")?.parse().context("gateway_port")?,
            login: field("tunnel_id")?.to_string(),
            key: Arc::new(keys::own_key(&dir.join("id_ed25519"))?),
            pins: Arc::new(pins),
        })
    }

    /// One login, held until it drops. Ok(false) when the gateway refused the
    /// login itself, which most likely means the tunnel was removed.
    async fn hold_once(&self, machine: &Arc<Machine>) -> Result<bool> {
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 3,
            inactivity_timeout: None,
            ..Default::default()
        });
        let client = Client {
            pins: self.pins.clone(),
            machine: machine.clone(),
        };
        let mut handle = tokio::time::timeout(
            Duration::from_secs(15),
            client::connect(config, (self.host.as_str(), self.port), client),
        )
        .await
        .context("no answer from the gateway")??;
        let key = PrivateKeyWithHashAlg::new(self.key.clone(), None);
        if !handle
            .authenticate_publickey(&self.login, key)
            .await?
            .success()
        {
            return Ok(false);
        }
        handle
            .tcpip_forward(FORWARD_HOST, FORWARD_PORT)
            .await
            .context("the gateway refused the forward")?;
        info!("Tunnel up");
        handle.await?;
        Ok(true)
    }
}

/// Holds the tunnel for the life of the process.
pub async fn hold(gateway: Gateway, machine: Arc<Machine>) -> Result<()> {
    let mut step = 5;
    loop {
        let started = Instant::now();
        let admitted = match gateway.hold_once(&machine).await {
            Ok(admitted) => admitted,
            Err(e) => {
                warn!("Tunnel down: {e:#}");
                true
            }
        };
        // A connection that held for a minute starts the waits over.
        if started.elapsed() >= Duration::from_secs(60) {
            step = 5;
        }
        let wait = if admitted {
            let wait = step;
            step = (step * 2).min(30);
            wait
        } else {
            // Asked again now and then rather than never, in case the
            // refusal was a mistake.
            warn!("The gateway refused this tunnel's login");
            600
        };
        // Between half and one and a half times the step, so machines a
        // gateway restart drops together come back spread out.
        let pause = rand::random_range(wait * 500..=wait * 1500);
        tokio::time::sleep(Duration::from_millis(pause)).await;
    }
}

struct Client {
    pins: Arc<Vec<PublicKey>>,
    machine: Arc<Machine>,
}

impl client::Handler for Client {
    type Error = anyhow::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool> {
        Ok(
            matches!(key, PublicKeyOrCertificate::PublicKey { key, .. } if keys::holds(&self.pins, key)),
        )
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<()> {
        if connected_address != FORWARD_HOST || connected_port != FORWARD_PORT {
            return Ok(()); // dropping the reply refuses the channel
        }
        reply.accept().await;
        // The login arrives from this machine's own loopback, as it does
        // when `ssh -R` hands the gateway's dial to the local sshd, so a key
        // line's `from=` reads the same either way.
        let peer = Peer {
            address: "127.0.0.1".into(),
            port: originator_port,
        };
        let machine = self.machine.clone();
        tokio::spawn(async move {
            if let Err(e) = machine.serve(channel.into_stream(), peer).await {
                warn!("A login ended with an error: {e:#}");
            }
        });
        Ok(())
    }
}
