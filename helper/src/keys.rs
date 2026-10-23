//! Every key file is OpenSSH format, so the folder reads the same as the one
//! `tunnel.sh` keeps and a key moves between the two unchanged.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

use anyhow::{Context, Result};
use russh::keys::ssh_key::LineEnding;
use russh::keys::{Algorithm, PrivateKey, PublicKey};

/// A key of this machine's own, made the first time it is asked for: its
/// host key, which the backend pins on first contact, and its tunnel key,
/// which the gateway knows the tunnel by. Both must outlive every restart.
pub fn own_key(path: &Path) -> Result<PrivateKey> {
    match fs::read_to_string(path) {
        Ok(text) => {
            PrivateKey::from_openssh(&text).with_context(|| format!("reading {}", path.display()))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
            put(path, &key.to_openssh(LineEnding::LF)?)?;
            Ok(key)
        }
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

/// The OpenSSH line of a key's public half.
pub fn public_line(key: &PrivateKey) -> Result<String> {
    Ok(key.public_key().to_openssh()?)
}

/// Writes a file whole under another name and moves it over, so a crash
/// never leaves half of one that every later start fails to read.
pub fn put(path: &Path, text: &str) -> Result<()> {
    let staged = path.with_extension("new");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&staged)
        .with_context(|| format!("writing {}", staged.display()))?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    fs::rename(&staged, path).with_context(|| format!("writing {}", path.display()))
}

/// The keys in an `authorized_keys` or `known_hosts` file. Options and host
/// patterns before a key are skipped, not applied: the helper allows one
/// thing, a command or SFTP as its own account, whatever a line says.
pub fn public_keys(path: &Path) -> Result<Vec<PublicKey>> {
    let text = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    Ok(text.lines().filter_map(key_in_line).collect())
}

fn key_in_line(line: &str) -> Option<PublicKey> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let words: Vec<&str> = line.split_whitespace().collect();
    (0..words.len()).find_map(|i| PublicKey::from_openssh(&words[i..].join(" ")).ok())
}

pub fn holds(keys: &[PublicKey], key: &PublicKey) -> bool {
    keys.iter().any(|k| k.key_data() == key.key_data())
}
