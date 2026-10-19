// Caută candidații fiecărui articol în D1 (FTS5), lasă un LLM să elimine produsele nepotrivite,
// apoi alege oferta cea mai ieftină din fiecare magazin pentru cantitatea dorită.
import { askLlm } from "./llm";
import { formatQuantity, words, type Quantity, type Unit } from "./normalize";
import type { Choice, Env, ListItem, Offer } from "./types";

const PER_STORE = 12; // câți candidați per magazin trimitem modelului
const FTS_LIMIT = 300;

interface Row {
  store: string;
  product_id: string;
  name: string;
  norm: string;
  price: number;
  qty_amount: number | null;
  qty_unit: Unit | null;
  by_weight: number;
  url: string | null;
}

function ftsQuery(terms: string[]): string {
  // "2.5%" → fraza "2 5" (tokenizerul FTS desparte la punct); cuvintele → căutare după prefix
  return terms
    .map((t) => {
      const tokens = t.match(/[a-z0-9]+/g) ?? [];
      if (!tokens.length) return "";
      return tokens.length > 1 ? `"${tokens.join(" ")}"` : `"${tokens[0]}"*`;
    })
    .filter(Boolean)
    .join(" ");
}

/** 2 = numele începe cu produsul („Lapte JLC”), 1 = al doilea cuvânt (după brand), 0 = altundeva („Biscuiti cu lapte”). */
function headScore(item: ListItem, norm: string): number {
  const nameWords = words(norm);
  const head = item.terms[0];
  if (nameWords[0]?.startsWith(head)) return 2;
  if (nameWords[1]?.startsWith(head)) return 1;
  return 0;
}

async function searchRows(db: D1Database, terms: string[]): Promise<Row[]> {
  const q = ftsQuery(terms);
  if (!q) return [];
  const { results } = await db
    .prepare(
      `SELECT p.store, p.product_id, p.name, p.norm, p.price, p.qty_amount, p.qty_unit, p.by_weight, p.url
       FROM products_fts JOIN products p ON p.rowid = products_fts.rowid
       WHERE products_fts MATCH ?1 ORDER BY rank LIMIT ${FTS_LIMIT}`,
    )
    .bind(q)
    .all<Row>();
  return results;
}

/** Cei mai buni candidați per magazin, în ordinea relevanței. */
export async function findCandidates(db: D1Database, item: ListItem): Promise<Offer[]> {
  let rows = await searchRows(db, item.terms);
  if (!rows.length && item.terms.length > 1) rows = await searchRows(db, item.terms.slice(0, 1));
  // plural românesc: „paini” → „paine”
  if (!rows.length && item.terms[0].endsWith("ini")) rows = await searchRows(db, [`${item.terms[0].slice(0, -3)}ine`]);
  // plural / alte forme: „paini” → „pain*” găsește „paine”
  for (let cut = 1; !rows.length && cut <= 2 && item.terms[0].length - cut >= 4; cut++) {
    rows = await searchRows(db, [item.terms[0].slice(0, -cut)]);
  }
  const byStore = new Map<string, { score: number; offer: Offer }[]>();
  rows.forEach((r) => {
    const offer: Offer = {
      id: `${r.store}:${r.product_id}`,
      store: r.store,
      name: r.name,
      norm: r.norm,
      price: r.price,
      qty: r.qty_amount && r.qty_unit ? { amount: r.qty_amount, unit: r.qty_unit } : null,
      byWeight: !!r.by_weight,
      url: r.url,
    };
    const list = byStore.get(r.store) ?? [];
    list.push({ score: headScore(item, r.norm), offer });
    byStore.set(r.store, list);
  });
  // sortare stabilă: scorul „cap de denumire”, apoi relevanța FTS
  return [...byStore.values()].flatMap((list) =>
    list.sort((a, b) => b.score - a.score).slice(0, PER_STORE).map((x) => x.offer),
  );
}

/** Fără LLM: păstrăm doar candidații cu cel mai bun scor din fiecare magazin. */
function heuristicFilter(item: ListItem, candidates: Offer[]): Offer[] {
  const best = new Map<string, number>();
  for (const o of candidates) best.set(o.store, Math.max(best.get(o.store) ?? 0, headScore(item, o.norm)));
  return candidates.filter((o) => headScore(item, o.norm) === best.get(o.store));
}

const SELECT_PROMPT = `Ești asistentul unui comparator de prețuri pentru supermarketuri din Chișinău.
Pentru fiecare articol din lista utilizatorului primești candidați găsiți prin căutare în catalogul magazinelor.
Întoarce, pentru fiecare articol, id-urile TUTUROR candidaților care sunt cu adevărat produsul cerut
(același tip de produs; caracteristicile cerute explicit, ex. 2.5% grăsime, trebuie respectate).
Exclude produsele care doar conțin cuvântul (ex. pentru "lapte": exclude "ciocolată cu lapte", "biscuiți cu lapte";
pentru "unt": exclude "unt de somon"; pentru "ouă": exclude "ouă de ciocolată").
Nu alege după preț, doar după potrivire. Dacă niciun candidat nu e potrivit, întoarce o listă goală.
Răspunde DOAR cu JSON, exact în forma: {"items":[{"item":0,"ids":["c0","c3"]},{"item":1,"ids":[]}]}`;


/** Pentru fiecare articol: candidații potriviți. LLM dacă e disponibil, altfel euristica. */
export async function filterCandidates(env: Env, items: ListItem[], candidates: Offer[][]): Promise<Offer[][]> {
  const fallback = () => items.map((item, i) => heuristicFilter(item, candidates[i]));
  if (!env.LLM_API_KEY || candidates.every((c) => !c.length)) return fallback();

  // id-uri scurte (c0, c1, …) ca să economisim tokeni
  const short = new Map<string, Offer>();
  const lines: string[] = [];
  items.forEach((item, i) => {
    const wanted = item.qty ? ` (cantitate dorită: ${formatQuantity(item.qty)})` : "";
    lines.push(`\n#${i} ${item.raw}${wanted}`);
    for (const o of candidates[i]) {
      const id = `c${short.size}`;
      short.set(id, o);
      lines.push(`${id}: ${o.name}`);
    }
  });

  try {
    const res = await askLlm<{ items: { item: number; ids: string[] }[] }>(env, SELECT_PROMPT, lines.join("\n").trim());
    const chosen: Offer[][] = items.map(() => []);
    for (const { item, ids } of Array.isArray(res.items) ? res.items : []) {
      if (!chosen[item] || !Array.isArray(ids)) continue;
      for (const id of ids) {
        const o = short.get(id);
        if (o && candidates[item].includes(o)) chosen[item].push(o);
      }
    }
    return chosen;
  } catch (e) {
    console.error("LLM filterCandidates a eșuat, folosesc euristica:", e);
    return fallback();
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function cost(item: ListItem, offer: Offer, wanted: Quantity | null): Choice {
  let packs = 1;
  if (wanted && offer.qty && offer.qty.unit === wanted.unit) {
    packs = offer.byWeight
      ? wanted.amount // la cântar: plătești exact cât iei
      : Math.max(1, Math.ceil(wanted.amount / offer.qty.amount - 0.2)); // toleranță 20%: 0.85 l ≈ 1 l
  }
  packs *= item.count;
  return { offer, packs, cost: Math.round(packs * offer.price * 100) / 100 };
}

/** Cea mai ieftină alegere per magazin dintre ofertele potrivite. */
export function choose(item: ListItem, offers: Offer[]): Map<string, Choice> {
  // Fără cantitate cerută: ambalajul tipic (mediana), ca să nu comparăm 50 g cu 1 kg.
  let wanted = item.qty;
  if (!wanted) {
    const sizes = offers.filter((o) => o.qty && !o.byWeight).map((o) => o.qty!);
    if (sizes.length) {
      const units = [...new Set(sizes.map((q) => q.unit))];
      const unit = units.reduce((a, b) =>
        sizes.filter((q) => q.unit === a).length >= sizes.filter((q) => q.unit === b).length ? a : b,
      );
      wanted = { amount: median(sizes.filter((q) => q.unit === unit).map((q) => q.amount)), unit };
    }
  }

  const byStore = new Map<string, Offer[]>();
  for (const o of offers) byStore.set(o.store, [...(byStore.get(o.store) ?? []), o]);

  const result = new Map<string, Choice>();
  for (const [store, list] of byStore) {
    let pool = list;
    if (wanted) {
      // nu cumpărăm 20 de pachete mici în locul unuia mare, nici un bidon de 5 l pentru 1 l
      const w = wanted;
      const sameSize = list.filter(
        (o) => o.qty && o.qty.unit === w.unit && (o.byWeight || (o.qty.amount / w.amount >= 0.2 && o.qty.amount / w.amount <= 3)),
      );
      if (sameSize.length) pool = sameSize;
    }
    const best = pool.map((o) => cost(item, o, wanted)).reduce((a, b) => (b.cost < a.cost ? b : a));
    result.set(store, best);
  }
  return result;
}
