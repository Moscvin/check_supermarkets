// Transformă mesajul utilizatorului în articole de căutat: cu Grok (text liber) sau, ca rezervă, rând cu rând.
import { askGrok } from "./grok";
import { normalize, parseQuantity, words, type Unit } from "./normalize";
import type { Env, ListItem } from "./types";

const COUNT_RE = /(?:^|\s)(?:x\s*(\d+)|(\d+)\s*x)(?=\s|$)/;
const QTY_WORDS_RE = /\d+(?:\.\d+)?\s*(kg|gr|g|ml|cl|l|buc)\b/g;
export const MAX_ITEMS = 40;

/** Rezerva fără AI: un produs pe rând, „produs [cantitate] [xN]” (ca în compare/matcher.py). */
export function parseLines(text: string): ListItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, MAX_ITEMS)
    .map((raw) => {
      let norm = normalize(raw);
      let count = 1;
      const m = COUNT_RE.exec(norm);
      if (m) {
        count = Number(m[1] ?? m[2]);
        norm = `${norm.slice(0, m.index)} ${norm.slice(m.index + m[0].length)}`.trim();
      }
      const terms = words(norm.replace(QTY_WORDS_RE, " ")).filter((w) => w.length >= 2 || w.endsWith("%"));
      return { raw, terms, qty: parseQuantity(norm), count };
    })
    .filter((item) => item.terms.length);
}

interface GrokItem {
  label: string;
  terms: string[];
  qty_amount: number | null;
  qty_unit: Unit | null;
  count: number;
}

const PARSE_PROMPT = `Ești asistentul unui comparator de prețuri pentru supermarketuri din Chișinău (Moldova).
Utilizatorul trimite o listă de cumpărături scrisă liber (română sau rusă, cu sau fără diacritice, pe rânduri sau separată prin virgule).
Transformă-o într-o listă de articole. Pentru fiecare articol:
- label: denumirea scurtă în română, cum ar scrie-o omul (ex. "lapte 2.5% 1l").
- terms: 1-3 cuvinte de căutare în română FĂRĂ diacritice, la forma folosită în denumirile produselor din magazine
  (ex. "lapte", "paine", "oua", "rosii", "cascaval", "unt", "ulei floarea soarelui" -> ["ulei","floarea"]).
  Primul termen e obligatoriu tipul produsului. Adaugă doar caracteristici esențiale cerute (grăsime "2.5%", soi, brand).
  Nu pune cantitatea în terms.
- qty_amount + qty_unit: cantitatea dorită pentru O bucată/ambalaj, în kg, l sau buc (ex. 500g -> 0.5 kg; "10 oua" -> 10 buc). null dacă nu e specificată.
- count: de câte ori (ex. "2 paini" -> count 2, qty null; "2 litri lapte" -> qty 2 l, count 1). Implicit 1.
Ignoră ce nu e produs de cumpărat. Maximum ${MAX_ITEMS} articole.`;

const PARSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          terms: { type: "array", items: { type: "string" } },
          qty_amount: { type: ["number", "null"] },
          qty_unit: { type: ["string", "null"], enum: ["kg", "l", "buc", null] },
          count: { type: "integer" },
        },
        required: ["label", "terms", "qty_amount", "qty_unit", "count"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export async function parseList(text: string, env: Env): Promise<ListItem[]> {
  if (env.XAI_API_KEY) {
    try {
      const res = await askGrok<{ items: GrokItem[] }>(env, PARSE_PROMPT, text, "shopping_list", PARSE_SCHEMA);
      const items = res.items
        .slice(0, MAX_ITEMS)
        .map((it) => ({
          raw: it.label,
          terms: it.terms.flatMap((t) => words(normalize(t))).filter((w) => w.length >= 2 || w.endsWith("%")),
          qty:
            it.qty_amount && it.qty_amount > 0 && ["kg", "l", "buc"].includes(it.qty_unit ?? "")
              ? { amount: it.qty_amount, unit: it.qty_unit! }
              : null,
          count: Math.max(1, Math.min(it.count || 1, 50)),
        }))
        .filter((it) => it.terms.length);
      if (items.length) return items;
    } catch (e) {
      console.error("Grok parseList a eșuat, folosesc parserul simplu:", e);
    }
  }
  return parseLines(text);
}
