import asyncio
import json
from contextlib import closing

import db
from pools import get_source, tmdb


async def _fetch_via_source(client, pool, media_type):
    source = get_source(pool["source"])
    return await source.fetch(client, json.loads(pool["config"]), media_type)


def _client_for(source):
    # Every v1 source exposes make_client(); fall back to tmdb's client for any
    # that doesn't, so the fetch path is uniform.
    return source.make_client() if hasattr(source, "make_client") \
        else tmdb.make_client()


def _diff(conn, pool_id, media_type, fetched):
    """Reconcile the items cache against the freshly fetched list: delete rows
    that vanished from the source, refresh rank on rows that stayed, insert new
    ones. Returns (added, removed, new_ids) where new_ids are the tmdb-keyed
    inserts that still need enriching.

    NULL-tmdb rows are diffed on normalized (title, year) in code because
    SQLite's UNIQUE treats every NULL as distinct — the identity check for
    metadata-bare items can't live in the schema.
    """
    existing = {r["tmdb_id"]: r for r in conn.execute(
        "SELECT * FROM items WHERE pool_id=?", (pool_id,)) if r["tmdb_id"]}
    existing_bare = {(db.normalize(r["title"]), r["year"]): r for r in conn.execute(
        "SELECT * FROM items WHERE pool_id=? AND tmdb_id IS NULL", (pool_id,))}
    fetched_ids = {i["tmdb_id"] for i in fetched if i["tmdb_id"]}
    fetched_bare = {(db.normalize(i["title"]), i["year"])
                    for i in fetched if not i["tmdb_id"]}

    removed = 0
    for tmdb_id, row in existing.items():
        if tmdb_id not in fetched_ids:
            conn.execute("DELETE FROM items WHERE id=?", (row["id"],))
            removed += 1
    for key, row in existing_bare.items():
        if key not in fetched_bare:
            conn.execute("DELETE FROM items WHERE id=?", (row["id"],))
            removed += 1

    added, new_ids = 0, []
    for it in fetched:
        if it["tmdb_id"] and it["tmdb_id"] in existing:
            conn.execute("UPDATE items SET rank=? WHERE id=?",
                         (it["rank"], existing[it["tmdb_id"]]["id"]))
            continue
        if not it["tmdb_id"] and \
                (db.normalize(it["title"]), it["year"]) in existing_bare:
            continue
        conn.execute(
            "INSERT INTO items(pool_id, media_type, tmdb_id, title, year, rank)"
            " VALUES (?,?,?,?,?,?)",
            (pool_id, media_type, it["tmdb_id"], it["title"], it["year"], it["rank"]))
        added += 1
        if it["tmdb_id"]:
            new_ids.append(it["tmdb_id"])
    conn.commit()
    return added, removed, new_ids


def _enrich_from_siblings(conn, pool_id, media_type, new_ids):
    """Fill metadata for freshly-inserted rows by copying from an
    already-enriched row with the same (media_type, tmdb_id) in ANY pool — so a
    300-item pool pays its TMDB calls once, then only for genuine deltas.

    Returns the tmdb_ids that still need a live TMDB fetch: those with no
    enriched sibling to copy from, plus any past failures in this pool
    (rating IS NULL) to retry on this pass.
    """
    need_fetch = []
    for tid in new_ids:
        donor = conn.execute(
            "SELECT runtime, seasons, genres, rating, poster FROM items"
            " WHERE media_type=? AND tmdb_id=? AND rating IS NOT NULL LIMIT 1",
            (media_type, tid)).fetchone()
        if donor:
            conn.execute(
                "UPDATE items SET runtime=?, seasons=?, genres=?, rating=?,"
                " poster=? WHERE pool_id=? AND tmdb_id=?",
                (*tuple(donor), pool_id, tid))
        else:
            need_fetch.append(tid)
    retry = [r["tmdb_id"] for r in conn.execute(
        "SELECT tmdb_id FROM items WHERE pool_id=? AND tmdb_id IS NOT NULL"
        " AND rating IS NULL", (pool_id,))]
    conn.commit()
    return list(dict.fromkeys(need_fetch + retry))


async def _fetch_missing(conn, pool_id, media_type, need_fetch):
    """Enrich the leftover ids from TMDB, throttled (<=4 concurrent, small
    delay) to stay inside the rate limit. A per-item failure is recorded (the
    row keeps its NULL fields) and retried on the next refresh rather than
    failing the whole pool. Returns (enriched, failed).
    """
    if not need_fetch:
        return 0, 0
    sem = asyncio.Semaphore(4)
    async with tmdb.make_client() as client:
        async def one(tid):
            async with sem:
                await asyncio.sleep(0.05)
                return tid, await tmdb.details(client, tid, media_type)
        results = await asyncio.gather(*(one(t) for t in need_fetch))

    enriched, failed = 0, 0
    for tid, d in results:
        if not d:
            failed += 1
            continue
        conn.execute(
            "UPDATE items SET runtime=?, seasons=?, genres=?, rating=?,"
            " poster=? WHERE pool_id=? AND tmdb_id=?",
            (d["runtime"], d["seasons"], json.dumps(d["genres"]),
             d["rating"], d["poster"], pool_id, tid))
        enriched += 1
    conn.commit()
    return enriched, failed


async def refresh_pool(pool_id: int) -> dict:
    """Refresh one pool: fetch its source list, reconcile the items cache, and
    enrich new items. A fetch failure keeps the previous cache and surfaces the
    error to the admin (this is why source.fetch is allowed to raise). Reads
    top-to-bottom as: load -> fetch -> diff -> enrich-from-siblings ->
    fetch-missing -> stamp.
    """
    with closing(db.get_conn()) as conn:
        pool = conn.execute("SELECT * FROM pools WHERE id=?", (pool_id,)).fetchone()
        if not pool:
            return {"ok": False, "error": "pool_not_found"}
        mt = pool["media_type"]
        source = get_source(pool["source"])
        try:
            async with _client_for(source) as client:
                fetched = await _fetch_via_source(client, pool, mt)
        except Exception as e:  # fetch failure: keep the previous cache intact
            return {"ok": False, "error": str(e)}

        added, removed, new_ids = _diff(conn, pool_id, mt, fetched)
        need_fetch = _enrich_from_siblings(conn, pool_id, mt, new_ids)
        enriched, failed = await _fetch_missing(conn, pool_id, mt, need_fetch)

        conn.execute("UPDATE pools SET refreshed_at=? WHERE id=?",
                     (db.utc_now(), pool_id))
        conn.commit()
        return {"ok": True, "added": added, "removed": removed,
                "enriched": enriched, "failed": failed}
