"""Raportul de comparație pentru o listă de cumpărături: folosit de CLI și de botul Telegram."""
from html import escape

from .matcher import Choice, Offer, find, parse_item

STORE_NAMES = {"linella": "Linella", "familymarket": "Family Market", "metro": "Metro", "bonus": "Bonus"}


def _store(s: str) -> str:
    return STORE_NAMES.get(s, s)


def build_report(lines: list[str], catalog: list[tuple[Offer, list[str]]], details: bool = True) -> str:
    """Text HTML (stilul Telegram: <b>, <i>, <a>)."""
    items = [parse_item(line) for line in lines if line.strip() and not line.lstrip().startswith("#")]
    if not items:
        return "Lista e goală. Scrie câte un produs pe rând, ex.:\n<code>lapte 2.5% 1l\npaine x2\nrosii 1kg</code>"
    stores = sorted({o.store for o, _ in catalog})
    results: list[tuple[str, dict[str, Choice]]] = [(item.raw, find(item, catalog)) for item in items]
    out: list[str] = []

    if details:
        for raw, choices in results:
            out.append(f"\n▸ <b>{escape(raw)}</b>")
            if not choices:
                out.append("   <i>negăsit</i>")
            for store in sorted(choices, key=lambda s: choices[s].cost):
                c = choices[store]
                per = f" · {c.offer.unit_price:.2f}/{c.offer.qty.unit}" if c.offer.unit_price else ""
                name = escape(c.offer.name)
                if c.offer.url:
                    name = f'<a href="{escape(c.offer.url)}">{name}</a>'
                out.append(f"   {_store(store)}: <b>{c.cost:.2f}</b> lei — {c.packs:g}× {name}{per}")

    out.append("\n<b>Total pe magazin</b>")
    totals = {}
    for store in stores:
        found = [ch[store] for _, ch in results if store in ch]
        totals[store] = (sum(c.cost for c in found), len(found))
    for store, (total, n) in sorted(totals.items(), key=lambda kv: (-kv[1][1], kv[1][0])):
        missing = "" if n == len(items) else f" <i>(lipsesc {len(items) - n})</i>"
        out.append(f"   {_store(store)}: <b>{total:.2f}</b> lei{missing}")

    complete = {s: t for s, (t, n) in totals.items() if n == len(items)}
    best = min(complete, key=complete.get) if complete else None
    if best:
        out.append(f"\n✅ Cel mai ieftin într-un singur magazin: <b>{_store(best)} — {complete[best]:.2f} lei</b>")
    else:
        out.append("\n⚠️ Niciun magazin nu are toate produsele.")

    # coș împărțit: fiecare produs de unde e cel mai ieftin
    split = [(raw, *min(ch.items(), key=lambda kv: kv[1].cost)) for raw, ch in results if ch]
    if len({s for _, s, _ in split}) > 1:
        split_total = sum(c.cost for _, _, c in split)
        saving = f", economisești {complete[best] - split_total:.2f} lei" if best else ""
        out.append(f"\n✂️ <b>Coș împărțit: {split_total:.2f} lei</b>{saving}")
        for store in sorted({s for _, s, _ in split}):
            names = ", ".join(escape(raw) for raw, s, _ in split if s == store)
            out.append(f"   {_store(store)}: {names}")

    out.append("\n<i>Prețuri de pe site-urile magazinelor; în magazin pot diferi.</i>")
    return "\n".join(out).strip()
