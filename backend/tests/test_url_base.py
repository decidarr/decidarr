import importlib


def test_url_base_prefixes_api_routes(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("URL_BASE", "/decidarr")
    import db, config, app as app_module
    importlib.reload(db)
    importlib.reload(config)
    importlib.reload(app_module)
    db.init_db(str(tmp_path / "t.db"))
    from fastapi.testclient import TestClient
    try:
        with TestClient(app_module.app) as c:
            assert c.get("/decidarr/api/health").status_code == 200
            assert c.get("/api/health").status_code == 404  # unprefixed no longer matched
    finally:
        # reload back to default so other tests are unaffected
        monkeypatch.delenv("URL_BASE", raising=False)
        importlib.reload(db)
        importlib.reload(config)
        importlib.reload(app_module)
