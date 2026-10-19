// Raportul HTML pentru Telegram (port al compare/report.py).
import { choose, filterCandidates, findCandidates } from "./match";
import type { Choice, Env, ListItem } from "./types";

const STORE_NAMES: Record<string, string> = {
  linella: "Linella", familymarket: "Family Market", metro: "Metro", bonus: "Bonus",
};
const storeName = (s: string) => STORE_NAMES[s] ?? s;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lei = (n: number) => n.toFixed(2);

export async function buildReport(env: Env, items: ListItem[], details: boolean): Promise<string> {
  const candidates = await Promise.all(items.map((item) => findCandidates(env.DB, item)));
  const matched = await filterCandidates(env, items, candidates);
  const results: Map<string, Choice>[] = items.map((item, i) => choose(item, matched[i]));
  const stores = [...new Set((await env.DB.prepare("SELECT DISTINCT store FROM products").all<{ store: string }>()).results.map((r) => r.store))].sort();
  const out: string[] = [];

  if (details) {
    items.forEach((item, i) => {
      out.push(`\n▸ <b>${esc(item.raw)}</b>`);
      const choices = results[i];
      if (!choices.size) out.push("   <i>negăsit</i>");
      [...choices.entries()]
        .sort((a, b) => a[1].cost - b[1].cost)
        .forEach(([store, c]) => {
          const unitPrice = c.offer.qty && !c.offer.byWeight ? ` · ${lei(c.offer.price / c.offer.qty.amount)}/${c.offer.qty.unit}` : "";
          const name = c.offer.url ? `<a href="${esc(c.offer.url)}">${esc(c.offer.name)}</a>` : esc(c.offer.name);
          out.push(`   ${storeName(store)}: <b>${lei(c.cost)}</b> lei — ${c.packs}× ${name}${unitPrice}`);
        });
    });
  }

  out.push("\n<b>Total pe magazin</b>");
  const totals = stores.map((store) => {
    const found = results.map((r) => r.get(store)).filter((c): c is Choice => !!c);
    return { store, total: found.reduce((s, c) => s + c.cost, 0), n: found.length };
  });
  totals
    .sort((a, b) => b.n - a.n || a.total - b.total)
    .forEach(({ store, total, n }) => {
      const missing = n === items.length ? "" : ` <i>(lipsesc ${items.length - n})</i>`;
      out.push(`   ${storeName(store)}: <b>${lei(total)}</b> lei${missing}`);
    });

  const complete = totals.filter((t) => t.n === items.length).sort((a, b) => a.total - b.total);
  const best = complete[0];
  out.push(
    best
      ? `\n✅ Cel mai ieftin într-un singur magazin: <b>${storeName(best.store)} — ${lei(best.total)} lei</b>`
      : "\n⚠️ Niciun magazin nu are toate produsele.",
  );

  // coș împărțit: fiecare produs de unde e cel mai ieftin
  const split = items.flatMap((item, i) => {
    const entries = [...results[i].entries()];
    if (!entries.length) return [];
    const [store, c] = entries.reduce((a, b) => (b[1].cost < a[1].cost ? b : a));
    return [{ raw: item.raw, store, cost: c.cost }];
  });
  const splitStores = [...new Set(split.map((s) => s.store))].sort();
  if (splitStores.length > 1) {
    const splitTotal = split.reduce((s, x) => s + x.cost, 0);
    const saving = best ? `, economisești ${lei(best.total - splitTotal)} lei` : "";
    out.push(`\n✂️ <b>Coș împărțit: ${lei(splitTotal)} lei</b>${saving}`);
    for (const store of splitStores) {
      out.push(`   ${storeName(store)}: ${split.filter((s) => s.store === store).map((s) => esc(s.raw)).join(", ")}`);
    }
  }
  out.push("\n<i>Prețuri de pe site-urile magazinelor; în magazin pot diferi.</i>");
  return out.join("\n").trim();
}

/** Telegram acceptă max 4096 de caractere pe mesaj. */
export function splitMessage(text: string, max = 4000): string[] {
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > max) {
      parts.push(current);
      current = "";
    }
    current += `${line}\n`;
  }
  if (current.trim()) parts.push(current);
  return parts;
}
