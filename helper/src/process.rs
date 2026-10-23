//! What one session channel runs, started and piped the way sshd does it for
//! a session with no pty: the account's shell with `-c`, in a session of its
//! own, from a clean environment, in the home folder.

use std::ffi::OsStr;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::process::ExitStatusExt;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;

use bytes::Bytes;
use russh::server::{Handle, Msg};
use russh::{Channel, ChannelId, ChannelMsg, ChannelWriteHalf, Sig};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;
use tracing::debug;

use crate::server::Machine;

/// What a session channel asked to run.
pub enum Start {
    /// A command, through the account's shell.
    Shell(Vec<u8>),
    /// The system's SFTP server, at this path.
    Sftp(PathBuf),
}

/// Starts what the channel asked for and pipes it through the channel.
/// `port` is the gateway's end of the dial, which the command sees as its
/// client's.
pub async fn run(
    channel: Channel<Msg>,
    handle: Handle,
    machine: Arc<Machine>,
    port: u32,
    start: Start,
) {
    let id = channel.id();
    let (rx, tx) = channel.split();
    match spawn(start, &machine, port) {
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

fn spawn(start: Start, machine: &Machine, port: u32) -> io::Result<Child> {
    let account = &machine.account;
    let mut cmd = match start {
        Start::Shell(command) => {
            let shell = &account.shell;
            let mut cmd = Command::new(shell);
            cmd.arg0(shell.file_name().unwrap_or(shell.as_os_str()))
                .arg("-c")
                .arg(OsStr::from_bytes(&command));
            cmd
        }
        Start::Sftp(server) => Command::new(server),
    };
    // The login arrives from this machine's own loopback, as it does when
    // `ssh -R` hands the gateway's dial to the local sshd, so a key line's
    // `from=` reads the same either way.
    cmd.env_clear()
        .env("USER", &account.name)
        .env("LOGNAME", &account.name)
        .env("HOME", &account.home)
        .env("SHELL", &account.shell)
        .env("PATH", DEFAULT_PATH)
        .env("MAIL", format!("/var/mail/{}", account.name))
        .env("SSH_CLIENT", format!("127.0.0.1 {port} 22"))
        .env("SSH_CONNECTION", format!("127.0.0.1 {port} 127.0.0.1 22"))
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

// The signals a command may be sent or end by, as named on the wire. The
// names russh has no variant for travel as `Custom`, both ways.
fn signals() -> [(libc::c_int, Sig); 13] {
    [
        (libc::SIGABRT, Sig::ABRT),
        (libc::SIGALRM, Sig::ALRM),
        (libc::SIGFPE, Sig::FPE),
        (libc::SIGHUP, Sig::HUP),
        (libc::SIGILL, Sig::ILL),
        (libc::SIGINT, Sig::INT),
        (libc::SIGKILL, Sig::KILL),
        (libc::SIGPIPE, Sig::PIPE),
        (libc::SIGQUIT, Sig::QUIT),
        (libc::SIGSEGV, Sig::SEGV),
        (libc::SIGTERM, Sig::TERM),
        (libc::SIGUSR1, Sig::USR1),
        (libc::SIGUSR2, Sig::Custom("USR2".into())),
    ]
}

fn sig(signo: libc::c_int) -> Sig {
    signals()
        .into_iter()
        .find(|(n, _)| *n == signo)
        .map_or_else(|| Sig::Custom(signo.to_string()), |(_, sig)| sig)
}

/// As sshd does, the signal goes to the command's own process only.
fn signal_child(pid: Option<u32>, signal: &Sig) {
    // Sig has no PartialEq.
    let same = |known: &Sig| match (known, signal) {
        (Sig::Custom(a), Sig::Custom(b)) => a == b,
        (a, b) => std::mem::discriminant(a) == std::mem::discriminant(b),
    };
    let Some((signo, _)) = signals().into_iter().find(|(_, known)| same(known)) else {
        return;
    };
    if let Some(pid) = pid {
        unsafe { libc::kill(pid as libc::pid_t, signo) };
    }
}
