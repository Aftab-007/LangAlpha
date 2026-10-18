"""Ginlix-data client for MCP servers running in Daytona sandboxes.

Authenticates with the short-lived token the server writes into the sandbox
and replaces before it runs out; the sandbox never refreshes it itself. This
is the sandbox counterpart to :class:`GinlixDataClient` (which uses service
tokens on the host).
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from ..market_data_provider import is_us_symbol
from ..normalize import normalize_bars
from .pagination import follow_cursor, paginate_cursor, unique_by_time
from .v2_routes import GinlixDataV2Routes, path_segment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Interval mapping (shared with MCP server for validation)
# ---------------------------------------------------------------------------

GINLIX_INTERVAL_MAP: dict[str, str] = {
    "1min": "1/minute",
    "5min": "5/minute",
    "15min": "15/minute",
    "30min": "30/minute",
    "1hour": "1/hour",
    "4hour": "4/hour",
    "1day": "1/day",
    "1week": "1/week",
    "1month": "1/month",
}

DAILY_INTERVALS: set[str] = {"daily", "1day"}

# ---------------------------------------------------------------------------
# Date/time utilities
# ---------------------------------------------------------------------------


def split_date_time(value: str | None) -> tuple[str | None, str | None]:
    """Split ``'YYYY-MM-DD HH:MM'`` into ``(date, time)``.

    Returns ``(date_part, time_part)``.  *time_part* is ``None`` for
    date-only values or midnight (``00:00``).
    """
    if not value:
        return None, None
    normalized = value.replace("T", " ")
    if " " in normalized:
        parts = normalized.split(" ", 1)
        time_part = parts[1].strip()
        if time_part.replace(":", "").replace("0", "") == "":
            return parts[0], None
        return parts[0], time_part
    return value, None


def filter_bars_by_time(
    bars: list[dict],
    start_time: str | None,
    end_time: str | None,
) -> list[dict]:
    """Filter normalized bars by time-of-day.  No-op if both times are None."""
    if not start_time and not end_time:
        return bars
    filtered = []
    for bar in bars:
        bar_date = bar.get("date", "")
        bar_time = ""
        if "T" in bar_date:
            bar_time = bar_date.split("T", 1)[1][:5]
        elif " " in bar_date:
            bar_time = bar_date.split(" ", 1)[1][:5]
        if not bar_time:
            filtered.append(bar)
            continue
        if start_time and bar_time < start_time[:5]:
            continue
        if end_time and bar_time > end_time[:5]:
            continue
        filtered.append(bar)
    return filtered


# ---------------------------------------------------------------------------
# Token file helpers
# ---------------------------------------------------------------------------

# Token file path. The host injects GINLIX_TOKEN_FILE with the exact path it
# uploaded to (_token_file_path = <work_dir>/_internal/.mcp_tokens.json), so the
# reader never has to guess. $HOME is NOT reliable here: Daytona sandboxes run as
# root ($HOME=/root) while the working dir is /home/workspace, so keying off $HOME
# read from the wrong place and the client always reported "not configured".
# The fallback mirrors SandboxLayout.default().mcp_tokens. It is spelled out
# because this module ships into the sandbox, where the host package is not
# importable; a unit test holds it equal to the layout object.
TOKEN_FILE = Path(
    os.environ.get("GINLIX_TOKEN_FILE", "/home/workspace/_internal/.mcp_tokens.json")
)

# Declared User-Agent for every sandbox→ginlix-data request. Set explicitly
# so the traffic is self-identifying at the edge and does not depend on
# httpx's default UA — a generic client UA can be swept up by
# upstream bot mitigation, which would silently break the data path.
_USER_AGENT = "langalpha-sandbox/1.0"


def _load_tokens() -> dict:
    try:
        return json.loads(TOKEN_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _token_stamp() -> tuple[int, int, int] | None:
    """Which token file is on disk. The server replaces it whole (a rename),
    so a new token is a new inode even within the same mtime tick."""
    try:
        st = TOKEN_FILE.stat()
    except OSError:
        return None
    return (st.st_ino, st.st_mtime_ns, st.st_size)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

_MAX_PAGES = 10  # Up to 500k bars (10 × 50k)


class GinlixMCPClient(GinlixDataV2Routes):
    """Sandbox-side ginlix-data client with token-file auth.

    Reads the token file again whenever it changes, so a token the server
    writes after this process started, or writes in place of one running out,
    is used from the next request on.
    """

    def __init__(self) -> None:
        self._http: httpx.AsyncClient | None = None
        self._stamp: tuple[int, int, int] | None = None

    # -- lifecycle -----------------------------------------------------------

    async def ensure(self) -> bool:
        """Ensure the HTTP client is initialized.  Returns availability."""
        stamp = _token_stamp()
        if self._http is None or stamp != self._stamp:
            self._load(stamp)
        return self._http is not None

    def _load(self, stamp: tuple[int, int, int] | None) -> None:
        tokens = _load_tokens()
        ginlix_url = tokens.get("ginlix_data_url") or os.getenv("GINLIX_DATA_URL", "")
        access_token = tokens.get("access_token", "")
        if not (ginlix_url and access_token):
            # Nothing usable on disk: a client already built keeps the token
            # it has, which may well still work.
            return
        self._stamp = stamp
        base_url = ginlix_url.rstrip("/")
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=base_url,
                headers={"User-Agent": _USER_AGENT},
                timeout=30.0,
            )
        elif str(self._http.base_url).rstrip("/") != base_url:
            self._http.base_url = base_url
        self._http.headers["Authorization"] = f"Bearer {access_token}"

    async def close(self) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None
            self._stamp = None

    # -- HTTP ----------------------------------------------------------------

    @staticmethod
    def _error_dict(action: str, e: Exception) -> dict:
        """Sanitized error dict for tool output; never embeds raw exception text.

        HTTP errors surface the status and response detail (parseable by the
        MCP servers' status→code mapper); anything else only the exception
        type — stringified httpx errors embed the request URL.
        """
        if isinstance(e, httpx.HTTPStatusError):
            try:
                detail = e.response.json().get("detail", e.response.text)
            except Exception:  # noqa: BLE001
                detail = e.response.text
            detail = str(detail)[:300]  # length-cap: never relay a full upstream body
            return {"error": f"ginlix-data error ({e.response.status_code}): {detail}"}
        return {"error": f"{action} failed ({type(e).__name__})"}

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """Make a ginlix-data request, retried once on a 401 that a token
        written while it was in flight may answer."""
        if not await self.ensure():
            raise RuntimeError("ginlix-data client not initialized")
        assert self._http is not None
        sent = self._http.headers.get("Authorization")
        resp = await self._http.request(method, url, **kwargs)
        if resp.status_code != 401:
            return resp
        self._load(_token_stamp())
        if self._http.headers.get("Authorization") == sent:
            return resp
        return await self._http.request(method, url, **kwargs)

    async def _v2_get(
        self, path: str, params: dict[str, Any] | None = None, *, user_id: str | None = None
    ) -> httpx.Response:
        # The sandbox token already names the user; ``user_id`` is a host header.
        if not await self.ensure():
            # A transport error, so v2 callers' soft-miss handling covers it.
            raise httpx.TransportError("ginlix-data client not configured")
        return await self.request("GET", path, params=params)

    # -- shared helpers ------------------------------------------------------

    async def _fetch_paginated_bars(
        self, url: str, params: dict[str, Any],
    ) -> list[dict]:
        """Every bar of an aggregates cursor walk, one per timestamp.

        Later pages keep the first page's params: the route requires ``from``
        and ``to`` on every call, so a cursor alone is rejected.
        """

        async def fetch_page(page_params: dict[str, Any]) -> dict[str, Any]:
            resp = await self.request("GET", url, params=page_params)
            resp.raise_for_status()
            return resp.json()

        bars, _ = await follow_cursor(fetch_page, params, max_pages=_MAX_PAGES, label=url)
        return unique_by_time(bars)

    # -- data fetching -------------------------------------------------------

    async def fetch_stock_data(
        self,
        symbol: str,
        interval: str,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict] | dict | None:
        """Fetch stock OHLCV from ginlix-data with auto-pagination.

        Returns:
            ``list[dict]``: Normalized OHLCV bars on success.
            ``dict``: Error dict on HTTP/validation error.
            ``None``: Not available (non-US symbol, no client, unsupported
            interval, network error) — caller should fall back.
        """
        if not is_us_symbol(symbol):
            return None

        if not await self.ensure():
            return None

        interval_lower = interval.lower()
        ginlix_interval = GINLIX_INTERVAL_MAP.get(interval_lower)
        if interval_lower in DAILY_INTERVALS:
            ginlix_interval = "1/day"
        if not ginlix_interval:
            return None

        _, start_time = split_date_time(start_date)
        _, end_time = split_date_time(end_date)
        from_day, _ = split_date_time(start_date)
        to_day, _ = split_date_time(end_date)

        if not from_day or not to_day:
            return None

        intraday = interval_lower not in DAILY_INTERVALS
        multiplier, timespan = ginlix_interval.split("/")
        params: dict[str, Any] = {
            "multiplier": multiplier,
            "timespan": timespan,
            "limit": 50000,
            "from": from_day,
            "to": to_day,
        }

        try:
            all_bars = await self._fetch_paginated_bars(
                f"/api/v1/data/aggregates/stock/{path_segment(symbol)}", params,
            )
            normalized = normalize_bars(all_bars, symbol, intraday=intraday)
            if intraday:
                normalized = filter_bars_by_time(normalized, start_time, end_time)
            return normalized
        except httpx.HTTPStatusError as e:
            error = self._error_dict("Stock data fetch", e)
            status = e.response.status_code
            if 400 <= status < 500 and status != 429:
                # The status rides along so the caller routes on it, not on
                # whatever the detail text happens to say.
                return {**error, "status": status}
            logger.warning("%s for %s", error["error"], symbol)
            return None
        except Exception:
            logger.debug("ginlix-data fetch failed for %s", symbol, exc_info=True)
            return None

    async def fetch_options_chain(
        self,
        underlying_ticker: str,
        contract_type: str | None = None,
        expiration_date_gte: str | None = None,
        expiration_date_lte: str | None = None,
        strike_price_gte: float | None = None,
        strike_price_lte: float | None = None,
        limit: int = 50,
    ) -> dict:
        """Fetch options contracts with auto-pagination.

        Returns a dict with ``results`` list of contracts, or an error dict.
        """
        if not await self.ensure():
            return {"error": "Options data requires ginlix-data (not configured)."}

        page_size = min(limit, 1000)
        params: dict[str, Any] = {
            "underlying_ticker": underlying_ticker,
            "limit": page_size,
        }
        if contract_type:
            params["contract_type"] = contract_type
        if expiration_date_gte:
            params["expiration_date.gte"] = expiration_date_gte
        if expiration_date_lte:
            params["expiration_date.lte"] = expiration_date_lte
        if strike_price_gte is not None:
            params["strike_price.gte"] = strike_price_gte
        if strike_price_lte is not None:
            params["strike_price.lte"] = strike_price_lte

        try:
            async def _fetch_page(p: dict) -> dict:
                resp = await self.request(
                    "GET", "/api/v1/data/options/contracts", params=p,
                )
                resp.raise_for_status()
                return resp.json()

            results = await paginate_cursor(_fetch_page, params, limit=limit)
            return {"results": results}
        except Exception as e:  # noqa: BLE001
            return self._error_dict("Options chain fetch", e)

    async def fetch_options_prices(
        self,
        options_ticker: str,
        from_date: str | None = None,
        to_date: str | None = None,
        interval: str = "1day",
    ) -> list[dict] | dict:
        """Fetch OHLCV bars for an options contract.

        Returns normalized OHLCV bars on success, or an error dict.
        """
        if not await self.ensure():
            return {"error": "Options data requires ginlix-data (not configured)."}

        interval_lower = interval.lower()
        ginlix_interval = GINLIX_INTERVAL_MAP.get(interval_lower)
        if interval_lower in DAILY_INTERVALS:
            ginlix_interval = "1/day"
        if not ginlix_interval:
            return {"error": f"Unsupported interval: {interval}"}

        multiplier, timespan = ginlix_interval.split("/")
        params: dict[str, Any] = {
            "multiplier": multiplier,
            "timespan": timespan,
            "limit": 50000,
        }
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date

        try:
            all_bars = await self._fetch_paginated_bars(
                f"/api/v1/data/aggregates/option/{path_segment(options_ticker)}", params,
            )
            intraday = interval_lower not in DAILY_INTERVALS
            normalized = normalize_bars(all_bars, options_ticker, intraday=intraday)
            return normalized
        except Exception as e:  # noqa: BLE001
            return self._error_dict("Options prices fetch", e)

    async def fetch_options_snapshot(
        self,
        options_tickers: str | list[str],
    ) -> dict:
        """Fetch real-time snapshots for options contracts.

        Accepts a single ticker string or a list of tickers.
        Returns a dict with ``data`` list of snapshot results, or an error dict.
        """
        if not await self.ensure():
            return {"error": "Options data requires ginlix-data (not configured)."}

        if isinstance(options_tickers, str):
            options_tickers = [options_tickers]

        try:
            resp = await self.request(
                "GET",
                "/api/v1/data/snapshots/options",
                params={"symbols": ",".join(options_tickers)},
            )
            resp.raise_for_status()
            body = resp.json()
            results = [
                r for r in body.get("results", [])
                if r.get("error") != "NOT_FOUND"
            ]
            return {"count": len(results), "data": results, "source": "ginlix-data"}
        except Exception as e:  # noqa: BLE001
            return self._error_dict("Options snapshot fetch", e)

    async def fetch_short_data(
        self,
        symbol: str,
        data_type: str = "both",
        from_date: str | None = None,
        to_date: str | None = None,
        limit: int = 20,
    ) -> dict:
        """Fetch short interest and/or short volume data."""
        if not await self.ensure():
            return {"error": "Short data requires ginlix-data (not configured)."}

        result: dict[str, Any] = {"symbol": symbol, "source": "ginlix-data"}

        if data_type in ("short_interest", "both"):
            params: dict[str, Any] = {
                "ticker": symbol,
                "limit": limit,
                "sort": "settlement_date.desc",
            }
            if from_date:
                params["settlement_date.gte"] = from_date
            if to_date:
                params["settlement_date.lte"] = to_date
            try:
                resp = await self.request(
                    "GET", "/api/v1/data/stocks/short-interest", params=params,
                )
                resp.raise_for_status()
                result["short_interest"] = resp.json().get("results", [])
            except Exception as e:  # noqa: BLE001
                result["short_interest_error"] = self._error_dict("Short interest fetch", e)["error"]

        if data_type in ("short_volume", "both"):
            params = {
                "ticker": symbol,
                "limit": limit,
                "sort": "date.desc",
            }
            if from_date:
                params["date.gte"] = from_date
            if to_date:
                params["date.lte"] = to_date
            try:
                resp = await self.request(
                    "GET", "/api/v1/data/stocks/short-volume", params=params,
                )
                resp.raise_for_status()
                result["short_volume"] = resp.json().get("results", [])
            except Exception as e:  # noqa: BLE001
                result["short_volume_error"] = self._error_dict("Short volume fetch", e)["error"]

        return result
