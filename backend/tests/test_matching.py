from matching import best_match

CANDS = [
    {"title": "The Thing", "year": 2011, "id": 1},
    {"title": "The Thing", "year": 1982, "id": 2},
    {"title": "Thing", "year": 1982, "id": 3},
]

def test_exact_title_and_year():
    m, conf = best_match(CANDS, "the thing", 1982)
    assert m["id"] == 2 and conf == "exact"

def test_fuzzy_year_within_one():
    m, conf = best_match(CANDS, "The Thing", 1983)
    assert m["id"] == 2 and conf == "fuzzy"

def test_fuzzy_when_year_missing():
    m, conf = best_match(CANDS, "The Thing", None)
    assert m["id"] == 1 and conf == "fuzzy"   # first title match in order

def test_no_match():
    assert best_match(CANDS, "Alien", 1979) == (None, "none")

def test_year_off_by_two_is_none():
    # locks the exact/fuzzy/none boundary: +/-1 is fuzzy, +/-2 is none.
    assert best_match(CANDS, "The Thing", 1984) == (None, "none")

def test_diacritics_and_punctuation():
    cands = [{"title": "Léon: The Professional", "year": 1994}]
    m, conf = best_match(cands, "leon the professional", 1994)
    assert m is not None and conf == "exact"

def test_leading_articles_not_dropped():
    cands = [{"title": "Thing", "year": 1982}]
    m, conf = best_match(cands, "The Thing", 1982)
    assert m is None and conf == "none"
