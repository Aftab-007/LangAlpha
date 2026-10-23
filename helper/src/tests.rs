//! The contract the backend's SSH provider holds a machine to, checked against
//! the helper's server over an in-memory stream: nothing listens and nothing
//! outside the test process can reach it.

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use russh::client::{self, Handle};
use russh::keys::{Algorithm, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Sig};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::server::{Machine, Peer};

// The runner the backend execs: the script arrives on stdin.
const RUNNER: &str = r#"exec bash --noprofile --norc -c 's=$(cat); exec </dev/null; eval "$s"'"#;

struct Trusting;

impl client::Handler for Trusting {
    type Error = anyhow::Error;

    async fn check_server_key(&mut self, _: &PublicKeyOrCertificate) -> Result<bool> {
        Ok(true)
    }
}

struct Rig {
    dir: TempDir,
    machine: Arc<Machine>,
    key: Arc<PrivateKey>,
}

impl Rig {
    fn new() -> Result<Self> {
        let dir = tempfile::tempdir()?;
        let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
        let line = key.public_key().to_openssh()?;
        fs::write(dir.path().join("authorized_keys"), format!("{line}\n"))?;
        let machine = Arc::new(Machine::load(dir.path())?);
        Ok(Self {
            dir,
            machine,
            key: Arc::new(key),
        })
    }

    async fn connect(&self) -> Result<Handle<Trusting>> {
        let (near, far) = tokio::io::duplex(1 << 16);
        let peer = Peer {
            address: "127.0.0.1".into(),
            port: 50022,
        };
        tokio::spawn(self.machine.clone().serve(far, peer));
        client::connect_stream(Arc::new(client::Config::default()), near, Trusting).await
    }

    async fn login_as(
        &self,
        user: &str,
        key: &Arc<PrivateKey>,
    ) -> Result<(Handle<Trusting>, bool)> {
        let mut handle = self.connect().await?;
        let admitted = handle
            .authenticate_publickey(user, PrivateKeyWithHashAlg::new(key.clone(), None))
            .await?
            .success();
        Ok((handle, admitted))
    }

    async fn login(&self) -> Result<Handle<Trusting>> {
        let (handle, admitted) = self.login_as(&self.machine.account.name, &self.key).await?;
        assert!(admitted, "the authorized key was refused");
        Ok(handle)
    }
}

#[derive(Default)]
struct Ran {
    stdout: String,
    stderr: String,
    status: Option<u32>,
    signal: Option<Sig>,
}

async fn exec(handle: &Handle<Trusting>, command: &str, input: &str) -> Result<Ran> {
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, command).await?;
    channel.data(input.as_bytes()).await?;
    channel.eof().await?;
    let mut ran = Ran::default();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => ran.stdout.push_str(&String::from_utf8_lossy(&data)),
            ChannelMsg::ExtendedData { data, ext: 1 } => {
                ran.stderr.push_str(&String::from_utf8_lossy(&data))
            }
            ChannelMsg::ExitStatus { exit_status } => ran.status = Some(exit_status),
            ChannelMsg::ExitSignal { signal_name, .. } => ran.signal = Some(signal_name),
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(ran)
}

#[tokio::test]
async fn runs_the_backends_script_runner() -> Result<()> {
    let rig = Rig::new()?;
    let handle = rig.login().await?;
    let ran = exec(&handle, RUNNER, "echo out; echo err >&2; exit 3\n").await?;
    assert_eq!(ran.stdout, "out\n");
    assert_eq!(ran.stderr, "err\n");
    assert_eq!(ran.status, Some(3));
    Ok(())
}

#[tokio::test]
async fn starts_from_a_clean_environment_in_home() -> Result<()> {
    let rig = Rig::new()?;
    let handle = rig.login().await?;
    // cargo sets CARGO_MANIFEST_DIR for this process; a login must not see it.
    let script = r#"printf '%s\n' "$USER" "$HOME" "$SSH_CONNECTION" "$(pwd -P)" "${CARGO_MANIFEST_DIR-unset}""#;
    let ran = exec(&handle, RUNNER, script).await?;
    let account = &rig.machine.account;
    let home = fs::canonicalize(&account.home)?;
    let expected = [
        account.name.clone(),
        account.home.display().to_string(),
        "127.0.0.1 50022 127.0.0.1 22".into(),
        home.display().to_string(),
        "unset".into(),
    ];
    assert_eq!(ran.stdout.lines().collect::<Vec<_>>(), expected);
    assert_eq!(ran.status, Some(0));
    Ok(())
}

#[tokio::test]
async fn reports_a_death_by_signal() -> Result<()> {
    let rig = Rig::new()?;
    let handle = rig.login().await?;
    let ran = exec(&handle, "kill -TERM $$", "").await?;
    assert!(matches!(ran.signal, Some(Sig::TERM)), "no TERM reported");
    assert_eq!(ran.status, None);
    Ok(())
}

#[tokio::test]
async fn leaves_a_command_running_when_its_channel_closes() -> Result<()> {
    let rig = Rig::new()?;
    let handle = rig.login().await?;
    let marker = rig.dir.path().join("finished");
    let channel = handle.channel_open_session().await?;
    let command = format!("sleep 1; echo done > '{}'", marker.display());
    channel.exec(true, command).await?;
    channel.close().await?;
    drop(handle);
    tokio::time::sleep(Duration::from_millis(2500)).await;
    assert_eq!(fs::read_to_string(&marker)?, "done\n");
    Ok(())
}

#[tokio::test]
async fn serves_sftp_with_the_systems_server() -> Result<()> {
    let rig = Rig::new()?;
    if rig.machine.sftp_server.is_none() {
        eprintln!("no sftp-server here; skipped");
        return Ok(());
    }
    let handle = rig.login().await?;
    let mut channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    // SSH_FXP_INIT at version 3, which sftp-server answers with its version.
    channel.data(&[0u8, 0, 0, 5, 1, 0, 0, 0, 3][..]).await?;
    let mut reply = Vec::new();
    while reply.len() < 5 {
        match channel.wait().await {
            Some(ChannelMsg::Success) => {}
            Some(ChannelMsg::Data { data }) => reply.extend_from_slice(&data),
            other => panic!("expected the server's version, got {other:?}"),
        }
    }
    const SSH_FXP_VERSION: u8 = 2;
    assert_eq!(reply[4], SSH_FXP_VERSION);
    Ok(())
}

#[tokio::test]
async fn refuses_what_the_backend_never_asks_for() -> Result<()> {
    let rig = Rig::new()?;
    let handle = rig.login().await?;
    let refused = |msg: Option<ChannelMsg>| matches!(msg, Some(ChannelMsg::Failure));

    let mut channel = handle.channel_open_session().await?;
    channel
        .request_pty(true, "xterm", 80, 24, 0, 0, &[])
        .await?;
    assert!(refused(channel.wait().await), "pty");
    channel.set_env(true, "LC_ALL", "C").await?;
    assert!(refused(channel.wait().await), "env");
    channel.request_shell(true).await?;
    assert!(refused(channel.wait().await), "shell");
    channel.request_subsystem(true, "other").await?;
    assert!(refused(channel.wait().await), "subsystem");
    Ok(())
}

#[tokio::test]
async fn admits_only_the_account_and_its_keys() -> Result<()> {
    let rig = Rig::new()?;
    let stranger = Arc::new(PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?);
    let (_, admitted) = rig.login_as("not-this-account", &rig.key).await?;
    assert!(!admitted, "another account");
    let (_, admitted) = rig.login_as(&rig.machine.account.name, &stranger).await?;
    assert!(!admitted, "an unknown key");

    // The file is read on every login, so a key added later is let in.
    let mut keys = fs::read_to_string(rig.dir.path().join("authorized_keys"))?;
    keys.push_str(&format!("{}\n", stranger.public_key().to_openssh()?));
    fs::write(rig.dir.path().join("authorized_keys"), keys)?;
    let (_, admitted) = rig.login_as(&rig.machine.account.name, &stranger).await?;
    assert!(admitted, "a key added after the start");
    Ok(())
}

#[tokio::test]
async fn forwards_to_this_machines_loopback_only() -> Result<()> {
    let rig = Rig::new()?;
    let handle = rig.login().await?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    tokio::spawn(async move {
        let (mut tcp, _) = listener.accept().await?;
        let mut buf = [0u8; 4];
        tcp.read_exact(&mut buf).await?;
        tcp.write_all(&buf).await?;
        anyhow::Ok(())
    });

    let channel = handle
        .channel_open_direct_tcpip("127.0.0.1", port.into(), "127.0.0.1", 0)
        .await?;
    let mut stream = channel.into_stream();
    stream.write_all(b"ping").await?;
    let mut echoed = [0u8; 4];
    stream.read_exact(&mut echoed).await?;
    assert_eq!(&echoed, b"ping");

    let elsewhere = handle
        .channel_open_direct_tcpip("192.0.2.1", 80, "127.0.0.1", 0)
        .await;
    assert!(elsewhere.is_err(), "a forward off this machine was opened");
    Ok(())
}
