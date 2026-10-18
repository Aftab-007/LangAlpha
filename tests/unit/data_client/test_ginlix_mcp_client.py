"""Error-sanitization guard for the sandbox-side ginlix-data client.

``GinlixMCPClient.fetch_short_data`` runs inside a Daytona sandbox and returns
its errors straight into agent-visible tool output. A stringified httpx error
embeds the request URL (internal host + query params), so the client routes
every non-HTTP failure through ``_error_dict``, which surfaces only the action
label plus the exception type — never the URL.
"""

import json
import os
from unittest.mock import AsyncMock

import httpx
import pytest

from src.data_client.ginlix_data import mcp_client
from src.data_client.ginlix_data.mcp_client import GinlixMCPClient

# Made-up internal endpoint — a stand-in whose host/path must never surface.
_LEAKY_URL = "https://data.internal.example:8005/api/v1/data/stocks/short-interest?ticker=AAPL"


def _no_url_leaked(msg: str) -> None:
    assert "https://" not in msg
    assert "data.internal.example" not in msg
    assert "/api/v1/data/" not in msg


class TestFetchShortDataErrorSanitization:
    @pytest.mark.asyncio
    async def test_both_connect_errors_omit_url(self):
        client = GinlixMCPClient()
        client.ensure = AsyncMock(return_value=True)
        client.request = AsyncMock(
            side_effect=httpx.ConnectError(f"connection refused to {_LEAKY_URL}")
        )

        result = await client.fetch_short_data("AAPL", data_type="both")

        assert result["symbol"] == "AAPL"
        assert result["source"] == "ginlix-data"
        # Only the action + exception type, no URL.
        assert result["short_interest_error"] == "Short interest fetch failed (ConnectError)"
        assert result["short_volume_error"] == "Short volume fetch failed (ConnectError)"
        _no_url_leaked(result["short_interest_error"])
        _no_url_leaked(result["short_volume_error"])
        # Failed fetches never populate the success keys.
        assert "short_interest" not in result
        assert "short_volume" not in result

    @pytest.mark.asyncio
    async def test_single_short_volume_connect_error_omits_url(self):
        client = GinlixMCPClient()
        client.ensure = AsyncMock(return_value=True)
        client.request = AsyncMock(
            side_effect=httpx.ConnectError(f"connection refused to {_LEAKY_URL}")
        )

        result = await client.fetch_short_data("AAPL", data_type="short_volume")

        assert result["short_volume_error"] == "Short volume fetch failed (ConnectError)"
        _no_url_leaked(result["short_volume_error"])
        # short_interest branch was never entered for this data_type.
        assert "short_interest_error" not in result


class TestV2OverTheSandboxTransport:
    @pytest.mark.asyncio
    async def test_non_json_page_is_an_http_error_not_a_decode_error(self, caplog):
        """A 200 HTML page (a route that never reached ginlix-data) reads as an
        outage: one ERROR line, and the CN source raises the httpx error every
        CN caller already treats as a miss."""
        from src.data_client.ginlix_data.cn_financial import GinlixDataCnFinancialSource

        client = GinlixMCPClient()
        client.ensure = AsyncMock(return_value=True)
        client.request = AsyncMock(return_value=httpx.Response(
            200, text="<!doctype html>", headers={"content-type": "text/html"},
            request=httpx.Request("GET", "http://ginlix-data.test/api/v2/data/fundamentals/x"),
        ))

        with caplog.at_level("INFO"), pytest.raises(httpx.HTTPError):
            await GinlixDataCnFinancialSource(client).get_company_profile("600519.SH")

        errors = [r for r in caplog.records if r.levelname == "ERROR"]
        assert len(errors) == 1 and "text/html" in errors[0].getMessage()
        assert not any(r.exc_info for r in caplog.records)

    @pytest.mark.asyncio
    async def test_contract_ticker_is_one_path_segment(self):
        client = GinlixMCPClient()
        client.ensure = AsyncMock(return_value=True)
        client.request = AsyncMock(return_value=httpx.Response(
            200, json={"results": []},
            request=httpx.Request("GET", "http://ginlix-data.test/"),
        ))

        await client.fetch_options_prices("O:SPY?x/../y", interval="1day")

        url = client.request.await_args.args[1]
        assert url == "/api/v1/data/aggregates/option/O%3ASPY%3Fx%2F..%2Fy"


def _write_token(path, token: str) -> None:
    """Replace the file whole, as the server does."""
    staged = path.with_suffix(".tmp")
    staged.write_text(
        json.dumps({"access_token": token, "ginlix_data_url": "http://ginlix-data.test"})
    )
    os.replace(staged, path)


class TestTokenFile:
    """The server writes every token; the client only reads, so a new one
    reaches it by the file changing."""

    @pytest.fixture
    def token_file(self, tmp_path, monkeypatch):
        path = tmp_path / ".mcp_tokens.json"
        monkeypatch.setattr(mcp_client, "TOKEN_FILE", path)
        return path

    @staticmethod
    def _client(handler) -> GinlixMCPClient:
        client = GinlixMCPClient()
        client._http = httpx.AsyncClient(
            base_url="http://ginlix-data.test", transport=httpx.MockTransport(handler)
        )
        return client

    @pytest.mark.asyncio
    async def test_a_replaced_file_is_read_before_the_next_request(self, token_file):
        seen: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request.headers["Authorization"])
            return httpx.Response(200, json={})

        client = self._client(handler)
        try:
            _write_token(token_file, "one")
            await client.request("GET", "/api/v2/data/quotes")
            await client.request("GET", "/api/v2/data/quotes")
            _write_token(token_file, "two")
            await client.request("GET", "/api/v2/data/quotes")
        finally:
            await client.close()

        assert seen == ["Bearer one", "Bearer one", "Bearer two"]

    @pytest.mark.asyncio
    async def test_a_401_retries_once_with_a_token_written_meanwhile(self, token_file):
        seen: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request.headers["Authorization"])
            if request.headers["Authorization"] == "Bearer fresh":
                return httpx.Response(200, json={})
            # The server's write lands while this request is in flight.
            _write_token(token_file, "fresh")
            return httpx.Response(401, json={"detail": "expired"})

        client = self._client(handler)
        try:
            _write_token(token_file, "stale")
            resp = await client.request("GET", "/api/v2/data/quotes")
        finally:
            await client.close()

        assert resp.status_code == 200
        assert seen == ["Bearer stale", "Bearer fresh"]

    @pytest.mark.asyncio
    async def test_a_401_with_no_newer_token_is_not_retried(self, token_file):
        seen: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request.headers["Authorization"])
            return httpx.Response(401, json={"detail": "revoked"})

        client = self._client(handler)
        try:
            _write_token(token_file, "revoked")
            resp = await client.request("GET", "/api/v2/data/quotes")
        finally:
            await client.close()

        assert resp.status_code == 401
        assert seen == ["Bearer revoked"]


class TestFetchStockDataStatus:
    @pytest.mark.parametrize(
        ("status", "reported"),
        [(401, True), (403, True), (400, True), (404, True), (429, False), (503, False)],
    )
    @pytest.mark.asyncio
    async def test_a_4xx_reaches_the_caller_with_its_status(self, status, reported):
        """price_data reads the status to decide whether FMP may still answer,
        so a 401 no newer token answered has to arrive as one."""
        client = GinlixMCPClient()
        client._http = httpx.AsyncClient(
            base_url="http://ginlix-data.test",
            transport=httpx.MockTransport(
                lambda request: httpx.Response(status, json={"detail": "nope"})
            ),
        )
        try:
            result = await client.fetch_stock_data("AAPL", "1day", "2026-10-01", "2026-10-08")
        finally:
            await client.close()

        if reported:
            assert result == {"error": f"ginlix-data error ({status}): nope", "status": status}
        else:
            assert result is None
