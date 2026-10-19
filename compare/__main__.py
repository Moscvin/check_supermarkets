"""Compară o listă de cumpărături între magazine.

    python -m compare lista.txt
    echo -e "lapte 2.5% 1l\\npaine x2\\nulei 1l" | python -m compare

Fiecare rând: produs [cantitate] [xN], ex. „lapte 2.5% 1l”, „rosii 1kg”, „paine x2”.
"""
import sys

from scraper import db

from .matcher import find, load_offers, parse_item


def main() -> int:
    source = open(sys.argv[1], encoding="utf-8") if len(sys.argv) > 1 else sys.stdin
    items = [parse_item(line) for line in source if line.strip() and not line.startswith("#")]
    catalog = load_offers(db.connect())
    stores = sorted({o.store for o, _ in catalog})

    results = [(item, find(item, catalog)) for item in items]

    for item, choices in results:
        print(f"\n▸ {item.raw}")
        if not choices:
            print("   negăsit în niciun magazin")
        for store in stores:
            c = choices.get(store)
            if c is None:
                print(f"   {store:<13} —")
                continue
            per = f" ({c.offer.unit_price:.2f} lei/{c.offer.qty.unit})" if c.offer.unit_price else ""
            print(f"   {store:<13} {c.cost:>8.2f} lei  {c.packs:g} × {c.offer.name}{per}")

    print("\n" + "═" * 60)
    totals = {}
    for store in stores:
        found = [ch[store] for _, ch in results if store in ch]
        totals[store] = (sum(c.cost for c in found), len(found))
        print(f"{store:<13} {totals[store][0]:>9.2f} lei   ({len(found)}/{len(items)} produse găsite)")

    complete = {s: t for s, (t, n) in totals.items() if n == len(items)}
    if complete:
        best = min(complete, key=complete.get)
        print(f"\n✔ Cel mai ieftin magazin cu toată lista: {best} — {complete[best]:.2f} lei")
    else:
        print("\n⚠ Niciun magazin nu are toate produsele; totalurile de mai sus nu sunt direct comparabile.")

    # coș împărțit: fiecare produs din magazinul unde e cel mai ieftin
    split = [min(ch.items(), key=lambda kv: kv[1].cost) for _, ch in results if ch]
    split_total = sum(c.cost for _, c in split)
    if len({s for s, _ in split}) > 1:
        print(f"\n✂ Coș împărțit: {split_total:.2f} lei", end="")
        if complete:
            print(f" (economisești {complete[best] - split_total:.2f} lei față de {best})")
        else:
            print()
        for (item, _), (store, c) in zip([r for r in results if r[1]], split):
            print(f"   {store:<13} {c.cost:>8.2f}  {item.raw}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
