# runtime/app/url_safety.py — SSRF guard para URLs pegadas por tenants.
#
# Cualquier URL que el tenant pegue en el onboarding fast pasa por es_url_publica()
# ANTES de entregarla a Playwright. Sin este filtro un atacante podría pegar
# http://169.254.169.254/latest/meta-data/ y leer credenciales IAM del runtime.
#
# Validamos:
#   - scheme en {http, https}
#   - hostname NO en blocklist (localhost, metadata.google.internal, etc.)
#   - puerto default o en {80, 443} (rechaza 22, 25, 6379, 5432, 3389, …)
#   - DNS resolve: NINGUNA IP devuelta cae en redes privadas / loopback / metadata
#
# Nota: el DNS lookup va por asyncio.get_event_loop().getaddrinfo para no
# bloquear el event loop del worker.

import asyncio
import ipaddress
import logging
from urllib.parse import urlparse

logger = logging.getLogger("ordychat.url_safety")

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),        # loopback IPv4
    ipaddress.ip_network("10.0.0.0/8"),         # RFC1918
    ipaddress.ip_network("172.16.0.0/12"),      # RFC1918
    ipaddress.ip_network("192.168.0.0/16"),     # RFC1918
    ipaddress.ip_network("169.254.0.0/16"),     # link-local + AWS/GCP metadata
    ipaddress.ip_network("100.64.0.0/10"),      # CGNAT (puede ser interno ISP)
    ipaddress.ip_network("224.0.0.0/4"),        # multicast
    ipaddress.ip_network("240.0.0.0/4"),        # reservado futuro
    ipaddress.ip_network("0.0.0.0/8"),          # broadcast / invalid
    ipaddress.ip_network("::1/128"),            # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),           # IPv6 ULA (private)
    ipaddress.ip_network("fe80::/10"),          # IPv6 link-local
    ipaddress.ip_network("ff00::/8"),           # IPv6 multicast
    ipaddress.ip_network("::ffff:0:0/96"),      # IPv4-mapped (puede saltarse filtros)
]

_BLOCKED_HOSTNAMES = frozenset({
    "localhost",
    "metadata.google.internal",
    "metadata.azure.com",
    "metadata.oraclecloud.com",
    "169.254.169.254",      # AWS / GCP / Azure metadata por IP directa
    "fd00:ec2::254",        # AWS IPv6 metadata
})

_ALLOWED_SCHEMES = frozenset({"http", "https"})
_ALLOWED_PORTS = frozenset({80, 443, None})  # None = no port explícito


async def es_url_publica(url: str) -> tuple[bool, str | None]:
    """
    Devuelve (True, None) si la URL apunta a una IP pública scrapeable.
    Devuelve (False, razón) si hay riesgo SSRF.
    """
    if not isinstance(url, str) or not url:
        return False, "url_vacía"

    try:
        parsed = urlparse(url)
    except Exception as e:  # urlparse es muy permisivo, raramente lanza
        return False, f"url_malformada: {e}"

    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        return False, f"scheme_no_permitido: {scheme or '<vacío>'}"

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False, "hostname_vacío"

    if hostname in _BLOCKED_HOSTNAMES:
        return False, f"hostname_bloqueado: {hostname}"

    try:
        port = parsed.port
    except ValueError:
        return False, "puerto_malformado"

    if port not in _ALLOWED_PORTS:
        return False, f"puerto_no_permitido: {port}"

    resolve_port = port if port is not None else (443 if scheme == "https" else 80)

    # DNS lookup asíncrono.
    try:
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(hostname, resolve_port)
    except Exception as e:
        return False, f"dns_error: {e}"

    if not infos:
        return False, "dns_sin_resultados"

    for info in infos:
        try:
            addr_str = info[4][0]
            ip = ipaddress.ip_address(addr_str)
        except (ValueError, IndexError):
            continue
        for net in _PRIVATE_NETWORKS:
            if ip in net:
                return False, f"ip_privada: {addr_str} in {net}"

    return True, None
