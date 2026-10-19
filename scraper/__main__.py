"""Rulare: python -m scraper [linella] [familymarket]  (fără argumente = toate magazinele)."""
import sys

from . import db, familymarket, linella

SCRAPERS = {linella.STORE: linella.scrape, familymarket.STORE: familymarket.scrape}


def main() -> int:
    stores = sys.argv[1:] or list(SCRAPERS)
    conn = db.connect()
    failed = []
    for store in stores:
        try:
            products = SCRAPERS[store]()
            db.save(conn, products)
            print(f"[{store}] salvat {len(products)} produse în {db.DB_PATH}")
        except Exception as e:  # un magazin căzut nu trebuie să le oprească pe celelalte
            print(f"[{store}] EROARE: {e!r}", file=sys.stderr)
            failed.append(store)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
