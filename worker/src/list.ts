// Transformă mesajul utilizatorului în articole de căutat: cu un LLM (text liber) sau, ca rezervă, rând cu rând.
import { askLlm } from "./llm";
import { normalize, parseQuantity, words, type Unit } from "./normalize";
import type { Env, ListItem } from "./types";

const COUNT_RE = /(?:^|\s)(?:x\s*(\d+)|(\d+)\s*x)(?=\s|$)/;
const QTY_WORDS_RE = /\d+(?:\.\d+)?\s*(kg|gr|g|ml|cl|l|buc)\b/g;
export const MAX_ITEMS = 40;

// cuvinte care nu sunt produse (normalizate, fără diacritice); numeralele devin „count”
const STOPWORDS = new Set(["un", "o", "niste", "vreau", "as", "vrea", "si", "cu", "de", "pentru", "la", "litru", "litri", "kilogram"]);
const NUMBER_WORDS: Record<string, number> = { doua: 2, doi: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10 };

/** Rezerva fără AI: un produs pe rând, „produs [cantitate] [xN]” (ca în compare/matcher.py). */
export function parseLines(text: string): ListItem[] {
  return text
    .split(/[\n;]|(?<!\d),|,(?!\d)|\s+(?:și|si)\s+/) // rânduri sau virgule, dar nu zecimalele („2,5%”)
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
      let qty = parseQuantity(norm);
      const terms: string[] = [];
      for (const w of words(norm.replace(QTY_WORDS_RE, " "))) {
        if (w in NUMBER_WORDS) count = Math.max(count, NUMBER_WORDS[w]);
        else if (/^\d+$/.test(w)) qty ??= { amount: Number(w), unit: "buc" }; // „10 oua” = 10 bucăți
        else if (!STOPWORDS.has(w) && (w.length >= 2 || w.endsWith("%"))) terms.push(w);
      }
      return { raw, terms, qty, count };
    })
    .filter((item) => item.terms.length);
}

interface LlmItem {
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
Ignoră ce nu e produs de cumpărat. Maximum ${MAX_ITEMS} articole.
Răspunde DOAR cu JSON, exact în forma:
{"items":[{"label":"lapte 2.5% 1l","terms":["lapte","2.5%"],"qty_amount":1,"qty_unit":"l","count":1}]}
(qty_unit e "kg", "l" sau "buc"; qty_amount și qty_unit sunt null dacă nu e specificată cantitatea).`;


export async function parseList(text: string, env: Env): Promise<ListItem[]> {
  if (env.LLM_API_KEY) {
    try {
      const res = await askLlm<{ items: LlmItem[] }>(env, PARSE_PROMPT, text);
      const items = (Array.isArray(res.items) ? res.items : [])
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
      console.error("LLM parseList a eșuat, folosesc parserul simplu:", e);
    }
  }
  return parseLines(text);
}
