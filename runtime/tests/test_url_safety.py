# runtime/tests/test_url_safety.py — Tests SSRF guard.

import pytest
from app.url_safety import es_url_publica


@pytest.mark.asyncio
async def test_rechaza_url_vacia():
    ok, reason = await es_url_publica("")
    assert ok is False
    assert reason == "url_vacía"


@pytest.mark.asyncio
async def test_rechaza_none_no_string():
    ok, reason = await es_url_publica(None)  # type: ignore[arg-type]
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_localhost_hostname():
    ok, reason = await es_url_publica("http://localhost/x")
    assert ok is False
    assert "bloqueado" in (reason or "")


@pytest.mark.asyncio
async def test_rechaza_metadata_aws_por_hostname():
    ok, reason = await es_url_publica("http://metadata.google.internal/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_metadata_aws_ip_directa():
    ok, reason = await es_url_publica("http://169.254.169.254/latest/meta-data/")
    assert ok is False
    assert "privada" in (reason or "") or "bloqueado" in (reason or "")


@pytest.mark.asyncio
async def test_rechaza_127_loopback_directa():
    ok, reason = await es_url_publica("http://127.0.0.1/admin")
    assert ok is False
    assert "privada" in (reason or "")


@pytest.mark.asyncio
async def test_rechaza_10_rfc1918():
    ok, _ = await es_url_publica("http://10.0.0.1/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_172_16_rfc1918():
    ok, _ = await es_url_publica("http://172.16.0.1/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_192_168_rfc1918():
    ok, _ = await es_url_publica("http://192.168.1.1/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_cgnat_100_64():
    ok, _ = await es_url_publica("http://100.64.0.1/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_ipv6_loopback():
    ok, _ = await es_url_publica("http://[::1]/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_puerto_ssh_22():
    ok, reason = await es_url_publica("http://example.com:22/")
    assert ok is False
    assert "puerto" in (reason or "")


@pytest.mark.asyncio
async def test_rechaza_puerto_postgres_5432():
    ok, _ = await es_url_publica("http://example.com:5432/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_puerto_redis_6379():
    ok, _ = await es_url_publica("http://example.com:6379/")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_scheme_file():
    ok, reason = await es_url_publica("file:///etc/passwd")
    assert ok is False
    assert "scheme" in (reason or "")


@pytest.mark.asyncio
async def test_rechaza_scheme_javascript():
    ok, _ = await es_url_publica("javascript:alert(1)")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_scheme_gopher():
    # Clásico vector SSRF: gopher:// puede hacer requests arbitrarios.
    ok, _ = await es_url_publica("gopher://example.com:6379/_INFO")
    assert ok is False


@pytest.mark.asyncio
async def test_rechaza_url_sin_hostname():
    ok, _ = await es_url_publica("http:///path")
    assert ok is False


@pytest.mark.asyncio
async def test_acepta_ip_publica_directa():
    # 1.1.1.1 (Cloudflare) es claramente pública — no depende de DNS.
    ok, reason = await es_url_publica("http://1.1.1.1/")
    assert ok is True, f"expected True, got reason={reason}"


@pytest.mark.asyncio
async def test_acepta_https_puerto_explicito_443():
    ok, _ = await es_url_publica("https://1.1.1.1:443/")
    assert ok is True


@pytest.mark.asyncio
async def test_acepta_http_puerto_explicito_80():
    ok, _ = await es_url_publica("http://1.1.1.1:80/")
    assert ok is True


@pytest.mark.asyncio
async def test_regression_google_maps_publica():
    # Solo verde si hay red; si offline, skip (no fake success).
    ok, reason = await es_url_publica("https://www.google.com/maps")
    if reason and "dns_error" in reason:
        pytest.skip("sin red")
    assert ok is True, f"expected True, got reason={reason}"
