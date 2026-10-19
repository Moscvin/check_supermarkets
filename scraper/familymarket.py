"""Family Market: site Laravel + Inertia. Cu headerul X-Inertia, /ro/catalog returnează JSON paginat (30/pagină)."""
import html
import json
import re
import time

import httpx

from .db import Product

STORE = "familymarket"
BASE = "https://familymarket.md"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) price-compare-bot"}


def _inertia_version(client: httpx.Client) -> str:
    page = client.get(f"{BASE}/ro/catalog").text
    m = re.search(r'data-page="([^"]+)"', page)
    if not m:
        raise RuntimeError("Family Market: nu găsesc data-page în HTML")
    return json.loads(html.unescape(m.group(1)))["version"]


def _to_product(item: dict) -> Product:
    unit = f'{item["weight"]} {item["measure"]}' if item.get("weight") else item.get("measure")
    return Product(
        store=STORE,
        product_id=item["ref_key"],
        name=item["name"].strip(),
        price=float(item["price"]),
        old_price=float(item["old_price"]) if item.get("old_price") else None,
        barcode=item.get("barcode") or None,
        category=item.get("category_label"),
        image_url=BASE + item["image_url"] if item.get("image_url") else None,
        unit=unit,
        in_stock=True,
    )


def scrape(delay: float = 0.3) -> list[Product]:
    products: dict[str, Product] = {}
    with httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        version = _inertia_version(client)
        page, last_page = 1, 1
        while page <= last_page:
            r = client.get(
                f"{BASE}/ro/catalog",
                params={"page": page},
                headers={"X-Inertia": "true", "X-Inertia-Version": version, "X-Requested-With": "XMLHttpRequest"},
            )
            if r.status_code == 409:  # site-ul a fost actualizat între timp: luăm versiunea nouă
                version = _inertia_version(client)
                continue
            r.raise_for_status()
            data = r.json()["props"]["products"]
            last_page = data["last_page"]
            for item in data["data"]:
                p = _to_product(item)
                products[p.product_id] = p
            print(f"[{STORE}] pagina {page}/{last_page}: {len(products)} produse", flush=True)
            page += 1
            time.sleep(delay)
    return list(products.values())
