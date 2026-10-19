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

## Rulare în Cloudflare (gratuit, calculatorul poate fi oprit)

```
GitHub Actions (zilnic) → scrapere Python → Cloudflare D1 ← Worker TypeScript ← webhook Telegram
                                                              └→ Grok (înțelege lista, alege produsele)
```

Pași (o singură dată; cheile le introduci tu, nu sunt în repo):

```bash
cd worker
npx wrangler login
npx wrangler d1 create supermarket          # copiază database_id în wrangler.jsonc
npx wrangler d1 execute supermarket --remote --file schema.sql
npx wrangler secret put TELEGRAM_BOT_TOKEN   # tokenul de la @BotFather
npx wrangler secret put TELEGRAM_SECRET      # un șir aleatoriu lung, ex.: openssl rand -hex 32
npx wrangler secret put XAI_API_KEY          # cheia de pe console.x.ai (opțional: fără ea merge fără Grok)
npx wrangler deploy                          # afișează URL-ul https://supermarket-bot.<cont>.workers.dev
```

Apoi leagă botul de Worker (înlocuiește valorile):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://supermarket-bot.<cont>.workers.dev/webhook" -d "secret_token=<TELEGRAM_SECRET>"
```

În GitHub (Settings → Secrets and variables → Actions) adaugă `CLOUDFLARE_API_TOKEN` (drept „D1: Edit”)
și `CLOUDFLARE_ACCOUNT_ID`, apoi rulează manual workflow-ul „Actualizare prețuri” (Actions → Run workflow).
D1 gratuit permite 100k scrieri pe zi, deci încărcarea inițială (~42.000 de produse) se completează în 3 zile.
Test local fără Telegram: `npx wrangler dev` cu `DEBUG=1` în `worker/.dev.vars`, apoi `GET /debug?list=lapte,paine`.
