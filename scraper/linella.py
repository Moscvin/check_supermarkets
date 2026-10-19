"""Linella: magazin CS-Cart. Căutarea cu q gol listează tot catalogul, 100 produse/pagină, în HTML."""
import time

import httpx
from selectolax.lexbor import LexborHTMLParser as HTMLParser, LexborNode as Node

from .db import Product

STORE = "linella"
BASE = "https://linella.md"
SEARCH_URL = f"{BASE}/cautare/"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) price-compare-bot"}


def _price(node: Node | None) -> float | None:
    """Prețul e afișat ca `47<sup>99</sup>` → 47.99."""
    if node is None:
        return None
    sup = node.css_first("sup")
    cents = sup.text(strip=True) if sup else "0"
    whole = (node.text(deep=False, strip=True) or "0").replace(" ", "").replace("\xa0", "")
    try:
        return float(f"{whole}.{cents or '0'}")
    except ValueError:
        return None


def _parse_item(item: Node) -> Product | None:
    pid_input = item.css_first('input[name$="[product_id]"]')
    title = item.css_first("a.product-title")
    if pid_input is None or title is None:
        return None
    pid = pid_input.attributes["value"]
    price = _price(item.css_first(f"#sec_discounted_price_{pid}"))
    if price is None:
        return None
    url = title.attributes.get("href")
    path = url.removeprefix(BASE).strip("/").split("/") if url else []
    img = item.css_first("img.ty-pict")
    image_url = None
    if img is not None:
        srcset = img.attributes.get("srcset") or img.attributes.get("data-srcset") or ""
        image_url = img.attributes.get("src") or (srcset.split()[0] if srcset else None)
    stock = item.css_first(".ty-qty-in-stock")
    return Product(
        store=STORE,
        product_id=pid,
        name=(title.attributes.get("title") or title.text()).strip(),
        price=price,
        old_price=_price(item.css_first(f"#sec_list_price_{pid}")),
        category="/".join(path[:-1]) or None,
        url=url,
        image_url=image_url,
        in_stock=None if stock is None else "stoc" in stock.text().lower() and "lipsă" not in stock.text().lower(),
    )


def scrape(delay: float = 0.5) -> list[Product]:
    products: dict[str, Product] = {}
    with httpx.Client(headers=HEADERS, timeout=90, follow_redirects=True) as client:
        page = 1
        while True:
            r = client.get(SEARCH_URL, params={"search_performed": "Y", "q": "", "subcats": "Y",
                                               "items_per_page": 100, "page": page,
                                               "sort_by": "product", "sort_order": "asc"})  # ordine stabilă între pagini
            r.raise_for_status()
            items = HTMLParser(r.text).css("div.ut2-gl__item")
            before = len(products)
            for item in items:
                p = _parse_item(item)
                if p:
                    products[p.product_id] = p
            print(f"[{STORE}] pagina {page}: {len(products)} produse", flush=True)
            # CS-Cart returnează ultima pagină din nou dacă depășim numărul de pagini
            if not items or len(products) == before:
                break
            page += 1
            time.sleep(delay)
    return list(products.values())
