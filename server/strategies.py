"""Strategy persistence — save/load named backtest configs to server/strategies/."""
import json
import re
from pathlib import Path

STRATEGIES_DIR = Path(__file__).parent / "strategies"


def _slug(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name.strip())[:64]


def save(name: str, config: dict) -> dict:
    STRATEGIES_DIR.mkdir(exist_ok=True)
    slug = _slug(name)
    if not slug:
        return {"ok": False, "error": "Invalid name"}
    (STRATEGIES_DIR / f"{slug}.json").write_text(
        json.dumps({"name": name, "config": config}, indent=2), encoding="utf-8"
    )
    return {"ok": True, "name": name, "slug": slug}


def list_all() -> list[dict]:
    if not STRATEGIES_DIR.exists():
        return []
    out = []
    for f in sorted(STRATEGIES_DIR.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            out.append({"name": d.get("name", f.stem), "slug": f.stem})
        except Exception:
            pass
    return out


def load(slug: str) -> dict | None:
    path = STRATEGIES_DIR / f"{_slug(slug)}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def delete(slug: str) -> bool:
    path = STRATEGIES_DIR / f"{_slug(slug)}.json"
    if path.exists():
        path.unlink()
        return True
    return False
