from db import normalize


def best_match(candidates, title, year):
    want = normalize(title)
    fuzzy = None
    for c in candidates:
        if normalize(c.get("title") or "") != want:
            continue
        cy = c.get("year")
        if year is not None and cy is not None:
            if cy == year:
                return c, "exact"
            if abs(cy - year) <= 1 and fuzzy is None:
                fuzzy = c
        elif fuzzy is None:
            fuzzy = c
    return (fuzzy, "fuzzy") if fuzzy else (None, "none")
