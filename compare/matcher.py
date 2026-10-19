"""Caută un articol din listă în fiecare magazin și alege oferta cea mai avantajoasă."""
import math
import re
import sqlite3
from dataclasses import dataclass
from statistics import median

from .normalize import Quantity, normalize, parse_quantity, words


@dataclass
class Offer:
    store: str
    name: str
    price: float
    qty: Quantity | None
    url: str | None

    @property
    def unit_price(self) -> float | None:
        """Preț pe kg / l / bucată."""
        return self.price / self.qty.amount if self.qty and self.qty.amount else None


@dataclass
class ListItem:
    raw: str
    terms: list[str]
    qty: Quantity | None  # cât vrea utilizatorul (ex. 1 l), dacă a specificat
    count: int            # de câte ori (ex. „x2”)


@dataclass
class Choice:
    offer: Offer
    packs: float  # câte ambalaje (sau kg, pentru produse la cântar)
    cost: float


_COUNT_RE = re.compile(r"(?:^|\s)(?:x\s*(\d+)|(\d+)\s*x)(?=\s|$)")


def parse_item(line: str) -> ListItem:
    text = normalize(line)
    count = 1
    m = _COUNT_RE.search(text)
    if m:
        count = int(m.group(1) or m.group(2))
        text = (text[:m.start()] + " " + text[m.end():]).strip()
    qty = parse_quantity(text)
    # cuvintele care nu țin de cantitate devin termeni de căutare
    no_qty = re.sub(r"\d+(?:\.\d+)?\s*(kg|gr|g|ml|cl|l|buc)\b", " ", text)
    terms = [w for w in words(no_qty) if len(w) >= 2 or w.endswith("%")]
    return ListItem(line.strip(), terms, qty, count)


def load_offers(conn: sqlite3.Connection) -> list[tuple[Offer, list[str]]]:
    """Ultimul preț al fiecărui produs aflat în stoc, cu numele deja împărțit în cuvinte."""
    rows = conn.execute("""
        SELECT p.store, p.name, pr.price, p.url, p.unit
        FROM products p
        JOIN prices pr ON pr.store = p.store AND pr.product_id = p.product_id
        WHERE pr.day = (SELECT MAX(day) FROM prices WHERE store = p.store AND product_id = p.product_id)
          AND COALESCE(p.in_stock, 1) = 1
    """).fetchall()
    result = []
    for store, name, price, url, unit in rows:
        norm = normalize(name)
        qty = parse_quantity(norm)
        # cantitatea din câmpul `unit` (zakaz: „1000 ml”, „1 kg” la cântar). „0.91 buc” de la Family Market e greutate brută, o ignorăm.
        if qty is None and unit and not unit.lower().endswith("buc"):
            qty = parse_quantity(normalize(unit))
        result.append((Offer(store, name, price, qty, url), words(norm)))
    return result


def _score(terms: list[str], name_words: list[str]) -> int | None:
    """None dacă nu se potrivește; altfel scor (mai mare = mai bun)."""
    for t in terms:
        if not any(w.startswith(t) for w in name_words):
            return None
    # primul termen e de obicei produsul („lapte”); dacă e chiar la începutul numelui,
    # e „Lapte JLC”, nu „Biscuiti cu lapte”. Unele nume încep cu brandul, deci acceptăm și al 2-lea cuvânt.
    head = terms[0]
    if name_words and name_words[0].startswith(head):
        return 2
    if len(name_words) > 1 and name_words[1].startswith(head):
        return 1
    return 0


def _cost(item: ListItem, offer: Offer, wanted: Quantity | None) -> Choice:
    if wanted and offer.qty and offer.qty.unit == wanted.unit:
        if offer.qty.amount == 1.0 and offer.qty.unit == "kg" and _sold_by_weight(offer):
            packs = wanted.amount  # la cântar: plătești exact cât iei
        else:
            # toleranță 20%: pentru „ulei 1l” o sticlă de 0.85 l e suficientă, nu două
            packs = max(1, math.ceil(wanted.amount / offer.qty.amount - 0.2))
    else:
        packs = 1
    packs *= item.count
    return Choice(offer, packs, round(packs * offer.price, 2))


def _sold_by_weight(offer: Offer) -> bool:
    return not re.search(r"\d\s*kg", normalize(offer.name))


def find(item: ListItem, catalog: list[tuple[Offer, list[str]]]) -> dict[str, Choice]:
    """Cea mai bună alegere pentru articol, per magazin."""
    if not item.terms:
        return {}
    by_store: dict[str, list[tuple[int, Offer]]] = {}
    for offer, name_words in catalog:
        s = _score(item.terms, name_words)
        if s is not None:
            by_store.setdefault(offer.store, []).append((s, offer))

    # Cantitatea dorită: cea scrisă de utilizator; altfel ambalajul tipic (mediana) din toate magazinele,
    # ca să nu comparăm 50 g dintr-un magazin cu 1 kg din altul.
    wanted = item.qty
    if wanted is None:
        sizes = [o.qty for c in by_store.values() for s, o in c if o.qty and s == max(x for x, _ in c)]
        if sizes:
            unit = max({q.unit for q in sizes}, key=lambda u: sum(q.unit == u for q in sizes))
            wanted = Quantity(median(q.amount for q in sizes if q.unit == unit), unit)

    result = {}
    for store, cands in by_store.items():
        best = max(s for s, _ in cands)
        top = [o for s, o in cands if s == best]
        if wanted:
            # nu cumpărăm 20 de pachete mici în locul unuia mare, nici un bidon de 5 l pentru 1 l
            same_unit = [o for o in top if o.qty and o.qty.unit == wanted.unit
                         and (_sold_by_weight(o) and o.qty.amount == 1.0
                              or 0.2 <= o.qty.amount / wanted.amount <= 3)]
            top = same_unit or top
        choices = [_cost(item, o, wanted) for o in top]
        result[store] = min(choices, key=lambda c: c.cost)
    return result
