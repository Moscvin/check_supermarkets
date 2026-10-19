// Port al compare/normalize.py: aceleași reguli, ca textul utilizatorului să arate ca `norm` din D1.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "t", ч: "ci", ш: "s",
  щ: "s", ы: "i", э: "e", ю: "iu", я: "ia", ь: "", ъ: "",
};

export type Unit = "kg" | "l" | "buc";

export interface Quantity {
  amount: number; // în unitatea de bază
  unit: Unit;
}

const UNITS: Record<string, [Unit, number]> = {
  kg: ["kg", 1], g: ["kg", 0.001], gr: ["kg", 0.001], grame: ["kg", 0.001],
  l: ["l", 1], ml: ["l", 0.001], cl: ["l", 0.01], litri: ["l", 1], litru: ["l", 1],
  buc: ["buc", 1], b: ["buc", 1], p: ["buc", 1], pl: ["buc", 1],
};
const UNIT_RE = Object.keys(UNITS).sort((a, b) => b.length - a.length).join("|");
const MULTI_RE = new RegExp(`(\\d+)\\s*[x×*]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\b`);
const QTY_RE = new RegExp(`(?<![\\d.])(\\d+(?:\\.\\d+)?)\\s*(${UNIT_RE})\\b`, "g");
const BY_WEIGHT_RE = /(?:^|[\s,/])(?:per\s+)?kg\b/;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => CYR[ch] ?? ch)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?%?|[a-z]+/g) ?? [];
}

export function parseQuantity(text: string): Quantity | null {
  const multi = MULTI_RE.exec(text);
  if (multi) {
    const [unit, factor] = UNITS[multi[3]];
    return { amount: Number(multi[1]) * Number(multi[2]) * factor, unit };
  }
  const matches = [...text.matchAll(QTY_RE)];
  if (matches.length) {
    const weighted = matches.filter((m) => UNITS[m[2]][0] !== "buc");
    const m = (weighted.length ? weighted : matches).at(-1)!;
    const [unit, factor] = UNITS[m[2]];
    if (Number(m[1]) > 0) return { amount: Number(m[1]) * factor, unit };
  }
  return BY_WEIGHT_RE.test(text) ? { amount: 1, unit: "kg" } : null;
}

export function formatQuantity(q: Quantity): string {
  if (q.unit === "buc") return `${q.amount} buc`;
  if (q.amount < 1) return `${+(q.amount * 1000).toFixed(1)} ${q.unit === "kg" ? "g" : "ml"}`;
  return `${+q.amount.toFixed(3)} ${q.unit}`;
}
