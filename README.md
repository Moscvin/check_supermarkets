# check_supermarkets

Colectează prețurile din supermarketurile din Chișinău într-o bază SQLite (`data/prices.db`).

| Magazin | Sursă |
|---|---|
| Linella | HTML din căutarea CS-Cart (`/cautare/?q=`), 100 produse/pagină |
| Family Market | JSON Inertia (`/ro/catalog` cu headerul `X-Inertia`), include cod de bare |

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m scraper              # toate magazinele
.venv/bin/python -m scraper linella      # doar unul
```

Tabele: `products` (ultima stare a fiecărui produs) și `prices` (un preț pe zi, pentru istoric).
