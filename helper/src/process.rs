//! What one session channel runs, started and piped the way sshd does it for
//! a session with no pty: the account's shell with `-c`, in a session of its
//! own, from a clean environment, in the home folder.

use std::ffi::OsStr;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::process::ExitStatusExt;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;

use bytes::Bytes;
use russh::server::{Handle, Msg};
use russh::{Channel, ChannelId, ChannelMsg, ChannelWriteHalf, Sig};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;
use tracing::debug;

use crate::server::{Machine, Peer};

pub async fn run(channel: Channel<Msg>, handle: Handle, machine: Arc<Machine>, peer: Peer) {
    let id = channel.id();
    let (mut rx, tx) = channel.split();
    // The handler has already answered each request; what it refused (a
    // shell, a pty, env) is passed over here.
    let started = loop {
        match rx.wait().await {
            Some(ChannelMsg::Exec { command, .. }) => {
                break shell(&machine, &peer, &command);
            }
            Some(ChannelMsg::RequestSubsystem { name, .. }) if name == "sftp" => {
                break sftp(&machine, &peer);
            }
            Some(ChannelMsg::Close) | None => return,
            Some(_) => {}
        }
    };
    match started {
        Ok(child) => pipe(child, rx, tx, handle, id).await,
        Err(e) => {
            // As a shell that cannot start its command: a message and 127.
            let _ = tx
                .extended_data_bytes(1, Bytes::from(format!("{e}\n")))
                .await;
            let _ = tx.exit_status(127).await;
            let _ = tx.eof().await;
            let _ = tx.close().await;
        }
    }
}

fn shell(machine: &Machine, peer: &Peer, command: &[u8]) -> io::Result<Child> {
    let shell = &machine.account.shell;
    let mut cmd = Command::new(shell);
    cmd.arg0(shell.file_name().unwrap_or(shell.as_os_str()))
        .arg("-c")
        .arg(OsStr::from_bytes(command));
    start(cmd, machine, peer)
}

fn sftp(machine: &Machine, peer: &Peer) -> io::Result<Child> {
    let path = machine
        .sftp_server
        .as_ref()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no sftp-server"))?;
    start(Command::new(path), machine, peer)
}

fn start(mut cmd: Command, machine: &Machine, peer: &Peer) -> io::Result<Child> {
    let account = &machine.account;
    cmd.env_clear()
        .env("USER", &account.name)
        .env("LOGNAME", &account.name)
        .env("HOME", &account.home)
        .env("SHELL", &account.shell)
        .env("PATH", DEFAULT_PATH)
        .env("MAIL", format!("/var/mail/{}", account.name))
        .env("SSH_CLIENT", format!("{} {} 22", peer.address, peer.port))
        .env(
            "SSH_CONNECTION",
            format!("{} {} 127.0.0.1 22", peer.address, peer.port),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(tz) = std::env::var_os("TZ") {
        cmd.env("TZ", tz);
    }
    // sshd falls back to / when the home folder is gone.
    cmd.current_dir(if account.home.is_dir() {
        account.home.as_path()
    } else {
        "/".as_ref()
    });
    // Its own session, so the command and what it starts are one group the
    // backend can signal, apart from this process.
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn()
}

// What sshd sets before the shell's own startup files run.
#[cfg(target_os = "macos")]
const DEFAULT_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
#[cfg(not(target_os = "macos"))]
const DEFAULT_PATH: &str = "/usr/local/bin:/usr/bin:/bin:/usr/games";

async fn pipe(
    mut child: Child,
    mut rx: russh::ChannelReadHalf,
    tx: ChannelWriteHalf<Msg>,
    handle: Handle,
    id: ChannelId,
) {
    // Gone once the command is reaped, so a signal sent while its output
    // drains never reaches a process that reused the pid.
    let mut pid = child.id();
    let stdout = child.stdout.take().expect("piped");
    let stderr = child.stderr.take().expect("piped");
    // Input goes through a task of its own, so a command that is slow to
    // read never holds up a signal or the end of its output.
    let (feed, fed) = mpsc::unbounded_channel();
    tokio::spawn(feed_stdin(child.stdin.take().expect("piped"), fed));
    let mut feed = Some(feed);
    let output = async { tokio::join!(tx.data(stdout), tx.extended_data(1, stderr)) };
    tokio::pin!(output);
    let (mut drained, mut exited) = (false, false);
    while !(drained && exited) {
        tokio::select! {
            msg = rx.wait() => match msg {
                Some(ChannelMsg::Data { data }) => {
                    if let Some(feed) = &feed {
                        let _ = feed.send(data);
                    }
                }
                Some(ChannelMsg::Eof) => feed = None,
                Some(ChannelMsg::Signal { signal }) => signal_child(pid, &signal),
                // The client is gone. As sshd does without a pty, the command
                // is left to finish on its own; its output has nowhere to go.
                Some(ChannelMsg::Close) | None => return,
                Some(_) => {}
            },
            _ = &mut output, if !drained => {
                drained = true;
                let _ = tx.eof().await;
            }
            status = child.wait(), if !exited => {
                exited = true;
                pid = None;
                match status {
                    Ok(status) => report_exit(&tx, &handle, id, status).await,
                    Err(e) => debug!("waiting on the command failed: {e}"),
                }
            }
        }
    }
    let _ = tx.close().await;
}

async fn feed_stdin(mut stdin: ChildStdin, mut fed: mpsc::UnboundedReceiver<Bytes>) {
    while let Some(chunk) = fed.recv().await {
        if stdin.write_all(&chunk).await.is_err() {
            return;
        }
    }
}

async fn report_exit(
    tx: &ChannelWriteHalf<Msg>,
    handle: &Handle,
    id: ChannelId,
    status: ExitStatus,
) {
    if let Some(code) = status.code() {
        let _ = tx.exit_status(code as u32).await;
    } else if let Some(signo) = status.signal() {
        let _ = handle
            .exit_signal_request(
                id,
                sig(signo),
                status.core_dumped(),
                String::new(),
                String::new(),
            )
            .await;
    }
}

fn sig(signo: libc::c_int) -> Sig {
    match signo {
        libc::SIGABRT => Sig::ABRT,
        libc::SIGALRM => Sig::ALRM,
        libc::SIGFPE => Sig::FPE,
        libc::SIGHUP => Sig::HUP,
        libc::SIGILL => Sig::ILL,
        libc::SIGINT => Sig::INT,
        libc::SIGKILL => Sig::KILL,
        libc::SIGPIPE => Sig::PIPE,
        libc::SIGQUIT => Sig::QUIT,
        libc::SIGSEGV => Sig::SEGV,
        libc::SIGTERM => Sig::TERM,
        libc::SIGUSR1 => Sig::USR1,
        libc::SIGUSR2 => Sig::Custom("USR2".into()),
        other => Sig::Custom(other.to_string()),
    }
}

/// As sshd does, the signal goes to the command's own process only.
fn signal_child(pid: Option<u32>, signal: &Sig) {
    let signo = match signal {
        Sig::ABRT => libc::SIGABRT,
        Sig::ALRM => libc::SIGALRM,
        Sig::FPE => libc::SIGFPE,
        Sig::HUP => libc::SIGHUP,
        Sig::ILL => libc::SIGILL,
        Sig::INT => libc::SIGINT,
        Sig::KILL => libc::SIGKILL,
        Sig::PIPE => libc::SIGPIPE,
        Sig::QUIT => libc::SIGQUIT,
        Sig::SEGV => libc::SIGSEGV,
        Sig::TERM => libc::SIGTERM,
        Sig::USR1 => libc::SIGUSR1,
        Sig::Custom(name) if name == "USR2" => libc::SIGUSR2,
        Sig::Custom(_) => return,
    };
    if let Some(pid) = pid {
        unsafe { libc::kill(pid as libc::pid_t, signo) };
    }
}
