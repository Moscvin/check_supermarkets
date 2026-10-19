"""Baza de date SQLite: produse per magazin + istoric de prețuri (un preț pe zi)."""
import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "prices.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    store       TEXT NOT NULL,
    product_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    barcode     TEXT,
    category    TEXT,
    url         TEXT,
    image_url   TEXT,
    unit        TEXT,
    in_stock    INTEGER,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (store, product_id)
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS prices (
    store       TEXT NOT NULL,
    product_id  TEXT NOT NULL,
    day         TEXT NOT NULL,
    price       REAL NOT NULL,
    old_price   REAL,
    PRIMARY KEY (store, product_id, day)
);
"""


@dataclass
class Product:
    store: str
    product_id: str
    name: str
    price: float
    old_price: float | None = None
    barcode: str | None = None
    category: str | None = None
    url: str | None = None
    image_url: str | None = None
    unit: str | None = None
    in_stock: bool | None = None


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


def save(conn: sqlite3.Connection, products: list[Product]) -> None:
    today = date.today().isoformat()
    conn.executemany(
        """INSERT INTO products (store, product_id, name, barcode, category, url, image_url, unit, in_stock, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(store, product_id) DO UPDATE SET
             name=excluded.name, barcode=COALESCE(excluded.barcode, barcode), category=excluded.category,
             url=excluded.url, image_url=excluded.image_url, unit=excluded.unit,
             in_stock=excluded.in_stock, updated_at=excluded.updated_at""",
        [(p.store, p.product_id, p.name, p.barcode, p.category, p.url, p.image_url, p.unit,
          None if p.in_stock is None else int(p.in_stock), today) for p in products],
    )
    conn.executemany(
        """INSERT OR REPLACE INTO prices (store, product_id, day, price, old_price) VALUES (?, ?, ?, ?, ?)""",
        [(p.store, p.product_id, today, p.price, p.old_price) for p in products],
    )
    conn.commit()
