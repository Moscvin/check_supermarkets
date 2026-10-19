import type { Quantity } from "./normalize";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET: string; // verificat în headerul X-Telegram-Bot-Api-Secret-Token
  XAI_API_KEY?: string; // fără cheie, botul merge cu potrivirea euristică
  GROK_MODEL: string;
  DEBUG?: string; // "1" activează GET /debug?list=... (doar local, în .dev.vars)
}

export interface ListItem {
  raw: string; // cum a scris utilizatorul
  terms: string[]; // cuvinte de căutare normalizate; primul e produsul („lapte”)
  qty: Quantity | null; // cantitatea dorită, dacă a specificat-o
  count: number; // „x2”
}

export interface Offer {
  id: string; // store:product_id
  store: string;
  name: string;
  norm: string;
  price: number;
  qty: Quantity | null;
  byWeight: boolean;
  url: string | null;
}

export interface Choice {
  offer: Offer;
  packs: number;
  cost: number;
}
