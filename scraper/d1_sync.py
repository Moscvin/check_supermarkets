"""Trimite catalogul din data/prices.db în Cloudflare D1, scriind doar produsele modificate.

    python -m scraper.d1_sync            # D1 din cloud (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
    python -m scraper.d1_sync --local    # D1 local al lui `wrangler dev`, pentru teste
    python -m scraper.d1_sync --dry-run  # doar afișează ce s-ar schimba

D1 gratuit permite 100k scrieri pe zi, de aceea comparăm cu hash-urile din D1 și trimitem doar diferențele.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from compare.normalize import normalize, product_quantity

from . import db

WORKER_DIR = Path(__file__).resolve().parent.parent / "worker"
D1_NAME = "supermarket"
COLUMNS = ("store", "product_id", "name", "norm", "price", "old_price", "qty_amount", "qty_unit",
           "by_weight", "url", "hash", "updated")
# dacă un magazin are azi mult mai puține produse decât în D1, scraperul probabil a eșuat parțial:
# nu ștergem nimic din acel magazin
MIN_KEEP_RATIO = 0.5
# D1 gratuit: 100k rânduri scrise pe zi, iar un produs nou scrie ~4 rânduri (tabel, index, FTS).
# Încărcarea inițială se face în mai multe zile; modificările de preț au prioritate.
MAX_STATEMENTS = int(os.environ.get("D1_MAX_STATEMENTS_PER_RUN", "15000"))


def wrangler(location: str, *args: str) -> str:
    cmd = ["npx", "--yes", "wrangler", "d1", "execute", D1_NAME, f"--{location}", *args]
    r = subprocess.run(cmd, cwd=WORKER_DIR, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"wrangler a eșuat:\n{r.stdout}\n{r.stderr}")
    return r.stdout


def local_rows() -> dict[tuple[str, str], tuple]:
    conn = db.connect()
    rows = conn.execute("""
        SELECT p.store, p.product_id, p.name, pr.price, pr.old_price, p.unit, p.url
        FROM products p
        JOIN prices pr ON pr.store = p.store AND pr.product_id = p.product_id
        WHERE pr.day = (SELECT MAX(day) FROM prices WHERE store = p.store AND product_id = p.product_id)
          AND COALESCE(p.in_stock, 1) = 1
          -- doar produsele văzute la ultima rulare a scraperului magazinului respectiv
          AND p.updated_at = (SELECT MAX(updated_at) FROM products WHERE store = p.store)
    """).fetchall()
    today = date.today().isoformat()
    result = {}
    for store, pid, name, price, old_price, unit, url in rows:
        norm = normalize(name)
        qty, by_weight = product_quantity(norm, unit)
        values = (store, pid, name, norm, price, old_price, qty.amount if qty else None,
                  qty.unit if qty else None, int(by_weight), url)
        h = hashlib.md5(json.dumps(values, ensure_ascii=False).encode()).hexdigest()[:16]
        result[(store, pid)] = (*values, h, today)
    return result


def remote_hashes(location: str) -> dict[tuple[str, str], str]:
    out = wrangler(location, "--json", "--command", "SELECT store, product_id, hash FROM products")
    rows = json.loads(out)[0]["results"]
    return {(r["store"], r["product_id"]): r["hash"] for r in rows}


def sql_value(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def build_sql(local: dict, remote: dict) -> tuple[list[str], dict]:
    stats = {"nou": 0, "modificat": 0, "șters": 0}
    inserts, changes, deletes = [], [], []
    updates = ", ".join(f"{c}=excluded.{c}" for c in COLUMNS[2:])
    for key, row in local.items():
        if remote.get(key) == row[10]:
            continue
        stats["modificat" if key in remote else "nou"] += 1
        (changes if key in remote else inserts).append(
            f"INSERT INTO products ({', '.join(COLUMNS)}) VALUES ({', '.join(map(sql_value, row))}) "
            f"ON CONFLICT(store, product_id) DO UPDATE SET {updates};"
        )

    for store in {s for s, _ in remote}:
        remote_count = sum(1 for s, _ in remote if s == store)
        local_count = sum(1 for s, _ in local if s == store)
        if local_count < remote_count * MIN_KEEP_RATIO:
            print(f"⚠ {store}: doar {local_count} produse local față de {remote_count} în D1, nu șterg nimic",
                  file=sys.stderr)
            continue
        for s, pid in remote:
            if s == store and (s, pid) not in local:
                stats["șters"] += 1
                deletes.append(f"DELETE FROM products WHERE store={sql_value(s)} AND product_id={sql_value(pid)};")
    return changes + deletes + inserts, stats  # ieftinele întâi, produsele noi la urmă


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="D1 local (wrangler dev) în loc de cel din cloud")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    location = "local" if args.local else "remote"

    wrangler(location, "--file", "schema.sql")
    local = local_rows()
    remote = remote_hashes(location)
    statements, stats = build_sql(local, remote)
    print(f"local: {len(local)} produse, D1: {len(remote)}; modificări: {stats}")
    if args.dry_run or not statements:
        return 0
    if not args.local and len(statements) > MAX_STATEMENTS:
        print(f"limită de scrieri: trimit {MAX_STATEMENTS} din {len(statements)}, restul la următoarea rulare")
        statements = statements[:MAX_STATEMENTS]

    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write("\n".join(statements))
    try:
        wrangler(location, "--file", f.name, "--yes")
    finally:
        Path(f.name).unlink()
    print("D1 actualizat")
    return 0


if __name__ == "__main__":
    sys.exit(main())
