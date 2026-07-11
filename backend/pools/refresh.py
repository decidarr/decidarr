import asyncio
import json

import db
from pools import get_source, tmdb


async def _fetch_via_source(client, pool, media_type):
    source = get_source(pool["source"])
    return await source.fetch(client, json.loads(pool["config"]), media_type)


async def refresh_pool(pool_id: int) -> dict:
    conn = db.get_conn()
    pool = conn.execute("SELECT * FROM pools WHERE id=?", (pool_id,)).fetchone()
    if not pool:
        conn.close()
        return {"ok": False, "error": "pool_not_found"}
    mt = pool["media_type"]
    source = get_source(pool["source"])
    try:
        async with source.make_client() if hasattr(source, "make_client") \
                else tmdb.make_client() as client:
            fetched = await _fetch_via_source(client, pool, mt)
    except Exception as e:  # fetch failure: keep previous cache
        conn.close()
        return {"ok": False, "error": str(e)}

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

    added, to_enrich = 0, []
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
            (pool_id, mt, it["tmdb_id"], it["title"], it["year"], it["rank"]))
        added += 1
        if it["tmdb_id"]:
            to_enrich.append(it["tmdb_id"])
    conn.commit()

    # incremental enrichment: copy from any already-enriched sibling row,
    # only hit TMDB for genuinely new ids (and past failures: rating IS NULL)
    need_fetch = []
    for tid in to_enrich:
        donor = conn.execute(
            "SELECT runtime, seasons, genres, rating, poster FROM items"
            " WHERE media_type=? AND tmdb_id=? AND rating IS NOT NULL LIMIT 1",
            (mt, tid)).fetchone()
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
    need_fetch = list(dict.fromkeys(need_fetch + retry))
    conn.commit()

    enriched, failed = 0, 0
    if need_fetch:
        sem = asyncio.Semaphore(4)
        async with tmdb.make_client() as client:
            async def one(tid):
                async with sem:
                    await asyncio.sleep(0.05)
                    return tid, await tmdb.details(client, tid, mt)
            results = await asyncio.gather(*(one(t) for t in need_fetch))
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
    conn.execute("UPDATE pools SET refreshed_at=? WHERE id=?",
                 (db.utc_now(), pool_id))
    conn.commit()
    conn.close()
    return {"ok": True, "added": added, "removed": removed,
            "enriched": enriched, "failed": failed}
