# check_supermarkets

Colectează prețurile din supermarketurile din Chișinău într-o bază SQLite (`data/prices.db`).

| Magazin | Sursă |
|---|---|
| Linella | HTML din căutarea CS-Cart (`/cautare/?q=`), 100 produse/pagină |
| Family Market | JSON Inertia (`/ro/catalog` cu headerul `X-Inertia`), include cod de bare |
| Metro, Bonus | API public zakaz.md (`stores-api.zakaz.md`), include cod de bare |

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m scraper              # toate magazinele
.venv/bin/python -m scraper linella      # doar unul
```

Tabele: `products` (ultima stare a fiecărui produs) și `prices` (un preț pe zi, pentru istoric).

## Compararea unei liste

```bash
.venv/bin/python -m compare lista_exemplu.txt
```

Un produs pe rând: `produs [cantitate] [xN]`, ex. `lapte 2.5% 1l`, `rosii 1kg`, `paine x2`.
Afișează totalul pe magazin, cel mai ieftin magazin cu toată lista și coșul împărțit între magazine.
Fără cantitate, se folosește ambalajul tipic al produsului, ca magazinele să fie comparate corect.

## Botul Telegram

Pune tokenul în `.env` (ignorat de git): `TELEGRAM_BOT_TOKEN=...`, apoi:

```bash
.venv/bin/python -m bot
```

Trimite botului lista (un produs pe rând). `/scurt` + listă = doar totalurile.
Botul reîncarcă automat prețurile când scraperele actualizează baza de date.
