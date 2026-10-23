//! Pairs this machine through the endpoints the pairing command's script
//! reports to, so a deployment takes a helper as it is. The helper reports
//! its own host key and no address, the deployment finds nothing it can dial
//! and asks it to connect out, as it does for a machine behind a router, and
//! the helper then holds that tunnel itself.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, bail};

use crate::account::Account;
use crate::keys;
use crate::tunnel::TUNNEL_FILE;

// The first line of the report's 202 that asks the machine to connect out.
const TUNNEL_CUE: &str = "tunnel";

pub struct Pairing {
    base: String,
    dir: PathBuf,
    report: Vec<(&'static str, String)>,
}

impl Pairing {
    /// Takes the deployment's key from the pairing command and reports the
    /// machine, which leaves the folder holding a tunnel ready to hold.
    pub async fn start(script_url: &str, dir: &Path) -> Result<Self> {
        let base = script_url
            .strip_suffix("/script")
            .context("expected the URL in the pairing command, ending in /script")?
            .to_string();
        let script = get(script_url.to_string()).await?;
        let key = key_line(&script).context("the pairing command names no key to authorize")?;
        keys::put(&dir.join("authorized_keys"), &format!("{key}\n"))?;

        let account = Account::current()?;
        let host_key = keys::own_key(&dir.join("host_key"))?;
        let tunnel_key = keys::own_key(&dir.join("id_ed25519"))?;
        let hostname = hostname();
        let mut report = vec![
            ("user", account.name.clone()),
            (
                "os",
                if cfg!(target_os = "macos") {
                    "Darwin"
                } else {
                    "Linux"
                }
                .into(),
            ),
            ("hostname", hostname.clone()),
            ("host_keys", keys::public_line(&host_key)?),
            ("run", format!("{:016x}", rand::random::<u64>())),
            ("can_tunnel", "1".into()),
        ];
        if let Some(tunnel_id) = paired_tunnel(dir) {
            report.push(("tunnel_id", tunnel_id));
        }
        let pairing = Self {
            base,
            dir: dir.to_path_buf(),
            report,
        };

        println!("Asking the deployment to connect...");
        let (code, body) = pairing.send(&[]).await?;
        let mut lines = body.lines();
        if code == 202 && lines.next() == Some(TUNNEL_CUE) {
            lines.for_each(|line| println!("{line}"));
            let (code, answer) = post(
                format!("{}/tunnel", pairing.base),
                vec![
                    ("public_key", keys::public_line(&tunnel_key)?),
                    ("hostname", hostname),
                ],
            )
            .await?;
            if code != 200 {
                return pairing.fail(&answer).await;
            }
            pairing.keep_tunnel(&answer)?;
        } else if code != 200 {
            return pairing.fail(&body).await;
        } else {
            println!("{body}");
        }
        Ok(pairing)
    }

    /// Asks the deployment to connect through the tunnel, now being held.
    pub async fn finish(&self) -> Result<()> {
        let Some(tunnel_id) = paired_tunnel(&self.dir) else {
            return Ok(());
        };
        println!("Asking the deployment to connect through the tunnel...");
        let (code, body) = self.send(&[("tunnel_id", tunnel_id)]).await?;
        println!("{body}");
        if code != 200 {
            bail!("the deployment could not reach this machine through its tunnel");
        }
        Ok(())
    }

    async fn send(&self, extra: &[(&'static str, String)]) -> Result<(u16, String)> {
        let mut form: Vec<_> = self
            .report
            .iter()
            .filter(|(name, _)| !extra.iter().any(|(other, _)| other == name))
            .cloned()
            .collect();
        form.extend_from_slice(extra);
        post(format!("{}/report", self.base), form).await
    }

    /// Tells the deployment why this run stopped, so the dialog waiting on it
    /// says so too rather than waiting until the command expires.
    async fn fail<T>(&self, reason: &str) -> Result<T> {
        let run = self.report.iter().find(|(name, _)| *name == "run");
        let mut form = vec![("failed", reason.to_string())];
        form.extend(run.cloned());
        let _ = post(format!("{}/report", self.base), form).await;
        bail!(
            "{}",
            if reason.is_empty() {
                "the deployment refused this machine"
            } else {
                reason
            }
        )
    }

    fn keep_tunnel(&self, answer: &str) -> Result<()> {
        let field = |name: &str| {
            answer
                .lines()
                .find_map(|line| line.strip_prefix(name)?.strip_prefix('='))
                .filter(|v| !v.is_empty())
                .with_context(|| format!("the deployment's answer names no {name}"))
        };
        let mut tunnel = String::new();
        for name in ["tunnel_id", "gateway_host", "gateway_port"] {
            let value = field(name)?;
            // These go into a host name and a login, so nothing else may.
            if !value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".:-".contains(c))
            {
                bail!("the deployment's answer could not be read");
            }
            tunnel.push_str(&format!("{name}={value}\n"));
        }
        keys::put(
            &self.dir.join("known_hosts"),
            &format!("{}\n", field("known_hosts")?),
        )?;
        keys::put(&self.dir.join(TUNNEL_FILE), &tunnel)
    }
}

fn paired_tunnel(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(TUNNEL_FILE)).ok()?;
    text.lines()
        .find_map(|line| line.strip_prefix("tunnel_id="))
        .map(str::to_string)
}

/// The key line from the script's `key=` assignment, which the server writes
/// as one single-quoted shell word.
fn key_line(script: &str) -> Option<String> {
    let quoted = script.lines().find_map(|line| line.strip_prefix("key="))?;
    let inner = quoted.strip_prefix('\'')?.strip_suffix('\'')?;
    Some(inner.replace(r#"'"'"'"#, "'"))
}

fn hostname() -> String {
    let mut buf = [0u8; 256];
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if rc != 0 {
        return String::new();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        // A report waits while the deployment dials the machine.
        .timeout_global(Some(Duration::from_secs(150)))
        .build()
        .into()
}

async fn get(url: String) -> Result<String> {
    tokio::task::spawn_blocking(move || -> Result<String> {
        let mut response = agent().get(&url).call()?;
        if response.status() != 200 {
            bail!(
                "the pairing command could not be fetched: {}",
                response.status()
            );
        }
        Ok(response.body_mut().read_to_string()?)
    })
    .await?
}

async fn post(url: String, form: Vec<(&'static str, String)>) -> Result<(u16, String)> {
    tokio::task::spawn_blocking(move || -> Result<(u16, String)> {
        let mut response = agent().post(&url).send_form(form)?;
        let body = response.body_mut().read_to_string()?;
        Ok((response.status().as_u16(), body.trim_end().to_string()))
    })
    .await?
}
