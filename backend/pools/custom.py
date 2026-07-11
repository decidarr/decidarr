import csv
import io
import json


def parse(filename: str, data: bytes) -> list[dict]:
    text = data.decode("utf-8-sig")
    if filename.lower().endswith(".json") or text.lstrip().startswith("["):
        try:
            rows = json.loads(text)
            assert isinstance(rows, list)
        except (json.JSONDecodeError, AssertionError):
            raise ValueError("bad_format")
        if not all(isinstance(r, dict) and "title" in r for r in rows):
            raise ValueError("bad_format")
        return [{"title": r["title"], "year": r.get("year"),
                 "tmdb_id": r.get("tmdb_id")} for r in rows]
    out = []
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if not row or row[0].strip().lower() == "title":
            continue
        year = None
        if len(row) > 1 and row[1].strip().isdigit():
            year = int(row[1].strip())
        out.append({"title": row[0].strip(), "year": year, "tmdb_id": None})
    if not out:
        raise ValueError("bad_format")
    return out


async def fetch(client, source_config, media_type):
    return [{"tmdb_id": r.get("tmdb_id"), "title": r["title"],
             "year": r.get("year"), "rank": i}
            for i, r in enumerate(source_config.get("items", []), 1)]
