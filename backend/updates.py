"""Update awareness (v1.10): is a newer image published than the one
running? Asks Docker Hub's public tags API — the registry reflects what
can actually be pulled, which makes it a truer source than git tags.
Optional integration: every failure path returns None/unknown, never an
exception (invariant #1)."""
import os
import re
import time

import httpx

import config

# Docker Hub public tags endpoint; UPDATE_CHECK_URL overrides it so tests
# and smokes can point at a fixture (internal knob, not documented).
DEFAULT_TAGS_URL = (
    "https://hub.docker.com/v2/repositories/decidarr/decidarr/tags"
    "?page_size=100")

_OFF_VALUES = {"0", "false", "no", "off"}

# (latest_or_None, fetched_at) — successful checks live 12h, failures 1h.
_cache: tuple[str | None, float] | None = None
_TTL_OK = 12 * 3600
_TTL_FAIL = 3600

_SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def enabled() -> bool:
    raw = config.resolve("update_check")
    return raw is None or raw.strip().lower() not in _OFF_VALUES


def parse_version(name: str) -> tuple[int, int, int] | None:
    """Strict x.y.z only — 'latest', 'v'-prefixed, and pre-release tags
    are noise here, not candidates."""
    m = _SEMVER.match(name)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=5)


async def fetch_latest(client: httpx.AsyncClient) -> str | None:
    url = os.environ.get("UPDATE_CHECK_URL") or DEFAULT_TAGS_URL
    try:
        r = await client.get(url)
        r.raise_for_status()
        names = [t.get("name", "") for t in r.json().get("results", [])]
    except Exception:
        return None
    versions = [(parse_version(n), n) for n in names]
    versions = [(v, n) for v, n in versions if v is not None]
    if not versions:
        return None
    return max(versions)[1]


def reset_cache() -> None:
    global _cache
    _cache = None


async def latest_version() -> str | None:
    """Cached check. None means unknown (disabled, down, or unparseable)."""
    global _cache
    if not enabled():
        return None
    now = time.monotonic()
    if _cache is not None:
        value, at = _cache
        ttl = _TTL_OK if value is not None else _TTL_FAIL
        if now - at < ttl:
            return value
    async with make_client() as client:
        value = await fetch_latest(client)
    _cache = (value, now)
    return value
