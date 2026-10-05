"""Generate SQL for D1 table clip_content from ../content_tags.json (written by content_tagger.py).

Writes migrations/data/content_tags_NN.sql (gitignored dir); apply each with:
  npx wrangler d1 execute loopforge-dashboard --remote --config wrangler.jsonc --file <file>
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "content_tags.json"
OUT = ROOT / "migrations" / "data"
CHUNK = 100
PER_FILE = 2000


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    tags = json.loads(SRC.read_text(encoding="utf-8"))
    rows = [f"({q(k)},{q(',' + ','.join(v['tags']) + ',' if v.get('tags') else ',')})"
            for k, v in sorted(tags.items()) if not v.get("error")]
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("content_tags_*.sql"):
        old.unlink()
    n = 0
    for i in range(0, len(rows), PER_FILE):
        part = rows[i:i + PER_FILE]
        lines = []
        if i == 0:
            lines.append("DELETE FROM clip_content;")
        for j in range(0, len(part), CHUNK):
            lines.append("INSERT OR REPLACE INTO clip_content (clip_key, tags) VALUES\n" + ",\n".join(part[j:j + CHUNK]) + ";")
        (OUT / f"content_tags_{n:02d}.sql").write_text("\n".join(lines), encoding="utf-8")
        n += 1
    print("rows", len(rows), "files", n)


if __name__ == "__main__":
    main()
