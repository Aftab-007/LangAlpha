"""Unit tests for the ptc-agent command line flags."""

import pytest

from ptc_cli import main


def _parse(monkeypatch, *argv):
    monkeypatch.setattr("sys.argv", ["ptc-agent", *argv])
    return main.parse_args()


def test_home_runs_in_home(monkeypatch, capsys):
    assert _parse(monkeypatch, "--home").home is True
    assert capsys.readouterr().err == ""


def test_no_flag_runs_in_a_workspace(monkeypatch):
    assert _parse(monkeypatch).home is False


def test_the_old_flash_flag_still_runs_in_home_and_says_so(monkeypatch, capsys):
    assert _parse(monkeypatch, "--flash").home is True
    err = capsys.readouterr().err
    assert err.count("\n") == 1
    assert "--home" in err


def test_flash_is_left_out_of_the_usage(monkeypatch, capsys):
    # The parser has no --help of its own; a bad flag prints the usage line.
    with pytest.raises(SystemExit):
        _parse(monkeypatch, "--no-such-flag")
    usage = capsys.readouterr().err
    assert "[--home]" in usage
    assert "--flash" not in usage
