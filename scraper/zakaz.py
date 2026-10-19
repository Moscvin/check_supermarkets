"""Platforma zakaz.md (Metro, Bonus): API JSON public, cu cod de bare. Prețurile sunt în bani (3199 = 31.99 lei)."""
import time

import httpx

from .db import Product

API = "https://stores-api.zakaz.md"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) price-compare-bot", "Accept-Language": "ro"}
# magazinul din Chișinău al fiecărei rețele (lista completă: GET /stores/)
STORES = {"metro": 48415602, "bonus": 484266118}
PER_PAGE = 60


def _to_product(store: str, r: dict) -> Product:
    if r.get("unit") == "kg":
        unit = "1 kg"  # la cântar: prețul e pe kg
    elif r.get("volume"):
        unit = f'{r["volume"]:g} ml'
    elif r.get("weight"):
        unit = f'{r["weight"]:g} g'
    else:
        unit = None
    discount = r.get("discount") or {}
    old = discount.get("old_price") if discount.get("status") else None
    return Product(
        store=store,
        product_id=r["ean"],
        name=r["title"].strip(),
        price=r["price"] / 100,
        old_price=old / 100 if old else None,
        barcode=r["ean"].lstrip("0") or None,
        category=r.get("category_id"),
        url=r.get("web_url"),
        image_url=(r.get("img") or {}).get("s350x350"),
        unit=unit,
        in_stock=r.get("in_stock"),
    )


def scrape(store: str, delay: float = 0.2) -> list[Product]:
    store_id = STORES[store]
    products: dict[str, Product] = {}
    with httpx.Client(headers=HEADERS, timeout=30) as client:
        categories = client.get(f"{API}/stores/{store_id}/categories/").json()
        for cat in categories:
            page = 1
            while True:
                r = client.get(f"{API}/stores/{store_id}/categories/{cat['id']}/products/",
                               params={"page": page, "per_page": PER_PAGE})
                r.raise_for_status()
                results = r.json()["results"]
                for item in results:
                    p = _to_product(store, item)
                    products[p.product_id] = p
                if len(results) < PER_PAGE:
                    break
                page += 1
                time.sleep(delay)
            print(f"[{store}] {cat['id']}: {len(products)} produse", flush=True)
    return list(products.values())
