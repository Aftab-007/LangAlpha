"""The line that lets the deployment log in to a machine its owner adds.

The client key authorizes the deployment on every machine the user adds, so
its line narrows what the key can do to what the deployment does with it: no
agent or X11 forwarding, and, once the deployment names the addresses its
connections come from (``SSHConfig.login_from``), logins only from those and
from the machine itself, which is where a tunnel delivers them. A copy of the
key taken from the deployment's database is then no use from anywhere else.

The line is written by whatever installs the key (the pairing script, the
command the user runs by hand), which add it when absent. Each start brings
the machine's lines for the key to the current one (``converge_script``), so
a change to ``login_from`` reaches the machines already added.
"""

from __future__ import annotations

import ipaddress
import re
import shlex
from collections.abc import Sequence

# Where a tunnel's connections reach sshd: the machine's own ssh client
# forwards them to localhost.
LOOPBACK = ("127.0.0.1", "::1")
_OPTIONS = "no-agent-forwarding,no-X11-forwarding"
_KEY = re.compile(r"^[A-Za-z0-9@.-]+ [A-Za-z0-9+/=]+( [A-Za-z0-9@._-]+)?$")


def authorized_key_line(public_key: str, login_from: Sequence[str] = ()) -> str:
    """The line for ``public_key`` ("ssh-ed25519 AAAA... comment").

    Raises:
        ValueError: The key is not one line of the shape a generated key has,
            or a source is not an address or network, either of which could
            carry text a shell or sshd would read as more.
    """
    key = public_key.strip()
    if not _KEY.fullmatch(key):
        raise ValueError("The public key is not a single OpenSSH key line.")
    for source in login_from:
        ipaddress.ip_network(source, strict=False)
    options = _OPTIONS
    if login_from:
        options = f'from="{",".join([*login_from, *LOOPBACK])}",{options}'
    return f"{options} {key}"


def admits(login_from: Sequence[str], address: str) -> bool:
    """Whether the line made from ``login_from`` lets in a login from ``address``.

    ``address`` is where the machine sees the connection come from
    (``$SSH_CONNECTION``), the address sshd matches ``from=`` against.
    """
    if not login_from:
        return True
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(
        ip in ipaddress.ip_network(source, strict=False)
        for source in (*login_from, *LOOPBACK)
    )


def converge_script(line: str) -> str:
    """Make ``line``, an :func:`authorized_key_line`, the only line in
    ``~/.ssh/authorized_keys`` that holds its key.

    Prints ``current``, ``updated``, ``absent`` (the login came by another
    file, which is left alone) or ``skipped``: a link, a file this account
    does not own (as a managed one is), or a line for the key the owner
    changed, by commenting it out or giving it options of their own, which
    is theirs to keep. Only a line as this module writes it, or the key
    bare, is ours to replace. The file is replaced whole, and only when the
    new one holds every other line byte for byte, so a failure part way, or
    a grep that reads the file as binary, leaves it as it was.
    """
    # Options, key type, key, comment: the options hold no spaces.
    _, key_type, blob, *_ = line.split()
    return f"""\
f="$HOME/.ssh/authorized_keys"
k={shlex.quote(line)}
y={shlex.quote(key_type)}
b={shlex.quote(blob)}
o={shlex.quote(_OPTIONS)}
if [ -L "$f" ] || [ ! -f "$f" ] || [ ! -O "$f" ]; then echo skipped; exit 0; fi
LC_ALL=C; export LC_ALL
m=$(grep -acF -- "$b" "$f")
[ $? -le 1 ] || {{ echo "Could not read $f" >&2; exit 1; }}
[ "$m" -gt 0 ] || {{ echo absent; exit 0; }}
# Ours: the key bare, or with the options authorized_key_line writes.
grep -aF -- "$b" "$f" | (
  set -f
  while IFS= read -r l; do
    set -- $l
    case $1 in
      "$y") [ "$2" = "$b" ] || exit 3 ;;
      "$o") [ "$2 $3" = "$y $b" ] || exit 3 ;;
      from=\\"*\\","$o")
        a=${{1#from=\\"}}; a=${{a%\\",$o}}
        case $a in *\\"*) exit 3 ;; esac
        [ "$2 $3" = "$y $b" ] || exit 3 ;;
      *) exit 3 ;;
    esac
  done
)
[ $? = 0 ] || {{ echo skipped; exit 0; }}
if [ "$m" = 1 ] && grep -aqxF -- "$k" "$f"; then echo current; exit 0; fi
lines() {{ n=$(($(wc -l < "$1"))); [ "$(tail -c 1 "$1" | wc -l)" -eq 1 ] || n=$((n + 1)); echo $n; }}
umask 077
t="$f.langalpha.$$"
grep -avF -- "$b" "$f" > "$t"
[ $? -le 1 ] || {{ rm -f "$t"; echo "Could not read $f" >&2; exit 1; }}
# grep ends every line it prints with a newline, the last one included.
kept=$(($(wc -c < "$t")))
ours=$(($(grep -aF -- "$b" "$f" | wc -c)))
whole=$(($(wc -c < "$f")))
[ "$(tail -c 1 "$f" | wc -l)" -eq 1 ] || whole=$((whole + 1))
printf '%s\\n' "$k" >> "$t" || {{ rm -f "$t"; echo "Could not rewrite $f" >&2; exit 1; }}
if [ "$(lines "$t")" -ne $(($(lines "$f") - m + 1)) ] || [ $((kept + ours)) -ne "$whole" ]; then
  rm -f "$t"
  echo "Left $f as it was: grep did not read its other lines back whole" >&2
  exit 1
fi
if chmod 600 "$t" && mv -f "$t" "$f"; then
  command -v restorecon >/dev/null 2>&1 && restorecon "$f" 2>/dev/null
  echo updated
else
  rm -f "$t"
  echo "Could not rewrite $f" >&2
  exit 1
fi
"""
