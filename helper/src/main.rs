//! Holds this machine's tunnel to a langalpha deployment and answers the
//! deployment's SSH logins over it itself, so the machine needs no sshd.
//!
//! To the deployment it is the same machine `tunnel.sh` sets up: the gateway
//! sees the tunnel's login and its `langalpha:22` forward, and the backend
//! logs in through it as it would to any SSH computer. Only the far end of
//! the forward differs, an SSH server in this process instead of the
//! machine's own.

mod account;
mod keys;
mod pair;
mod process;
mod server;
mod tunnel;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(version, about)]
enum Command {
    /// Pairs this machine with a deployment, then holds its tunnel.
    Pair {
        /// The URL in the deployment's pairing command, ending in /script.
        url: String,
        #[arg(long)]
        dir: PathBuf,
    },
    /// Holds the tunnel of a machine already paired.
    Run {
        /// The folder pairing filled: the deployment's keys, the tunnel and
        /// this machine's own keys.
        #[arg(long)]
        dir: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();
    match Command::parse() {
        Command::Pair { url, dir } => {
            std::fs::create_dir_all(&dir)?;
            let pairing = pair::Pairing::start(&url, &dir).await?;
            let holding = tokio::spawn(hold(dir));
            pairing.finish().await?;
            holding.await?
        }
        Command::Run { dir } => hold(dir).await,
    }
}

async fn hold(dir: PathBuf) -> Result<()> {
    let machine = Arc::new(server::Machine::load(&dir)?);
    tunnel::hold(tunnel::Gateway::load(&dir)?, machine).await
}
