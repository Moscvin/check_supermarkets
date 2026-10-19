// Worker Cloudflare: webhook Telegram → listă (LLM) → căutare în D1 → raport.
import { dispatch, latestRun, type Run } from "./github";
import { MAX_ITEMS, parseList } from "./list";
import { buildReport, splitMessage } from "./report";
import type { Env } from "./types";

const HELP = `Trimite-mi lista de cumpărături, <b>scrisă cum vrei</b>:

<code>lapte 2.5% 1l, 2 pâini, roșii 1kg, ulei de floarea soarelui, 10 ouă</code>

Îți spun cât costă în fiecare magazin (Linella, Family Market, Metro, Bonus), unde e cel mai ieftin și cât economisești dacă împarți coșul.

Pune cantitatea (<code>1l</code>, <code>500g</code>, <code>1kg</code>) pentru o comparație corectă; <code>x2</code> = două bucăți.
/scurt + listă = doar totalurile, fără detalii.
/actualizeaza = reîncarcă prețurile din magazine (doar proprietarul), /status = starea ultimei actualizări.`;

const SYNC_BUTTON = { inline_keyboard: [[{ text: "🔄 Actualizează prețurile", callback_data: "sync" }]] };

interface Update {
  message?: { chat: { id: number }; text?: string; message_id: number };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

async function telegram(env: Env, method: string, body: object): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`Telegram ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const send = (env: Env, chat_id: number, text: string, reply_markup?: object) =>
  telegram(env, "sendMessage", {
    chat_id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup,
  });

const isOwner = (env: Env, chatId: number) => !!env.OWNER_CHAT_ID && String(chatId) === env.OWNER_CHAT_ID.trim();

const when = (iso: string) =>
  new Date(iso).toLocaleString("ro-RO", { timeZone: "Europe/Chisinau", dateStyle: "short", timeStyle: "short" });

function describeRun(run: Run): string {
  const state =
    run.status !== "completed" ? "⏳ rulează" : run.conclusion === "success" ? "✅ reușită" : `❌ ${run.conclusion ?? "eșuată"}`;
  return `${state}, pornită ${when(run.createdAt)} — <a href="${run.url}">detalii</a>`;
}

/** Verificări comune pentru comenzile care ating GitHub: doar proprietarul, doar cu token. */
async function guardOwner(env: Env, chatId: number): Promise<boolean> {
  if (!env.OWNER_CHAT_ID) {
    await send(env, chatId, "Proprietarul nu e setat. Trimite /id și pune numărul în configurația botului.");
    return false;
  }
  if (!isOwner(env, chatId)) {
    await send(env, chatId, "Doar proprietarul botului poate actualiza prețurile.");
    return false;
  }
  if (!env.GITHUB_TOKEN) {
    await send(env, chatId, "Lipsește secretul GITHUB_TOKEN în Cloudflare, deci nu pot porni actualizarea.");
    return false;
  }
  return true;
}

async function startSync(env: Env, chatId: number): Promise<void> {
  if (!(await guardOwner(env, chatId))) return;
  const run = await latestRun(env);
  // un singur job odată: nu risipim scrierile gratuite D1 (100.000 pe zi)
  if (run && run.status !== "completed") {
    return void (await send(env, chatId, `O actualizare rulează deja: ${describeRun(run)}`));
  }
  await dispatch(env);
  await send(env, chatId, "✅ Actualizarea a pornit. Durează aproximativ 20 de minute; vezi starea cu /status.");
}

async function showStatus(env: Env, chatId: number): Promise<void> {
  if (!(await guardOwner(env, chatId))) return;
  const run = await latestRun(env);
  await send(env, chatId, run ? `Ultima actualizare: ${describeRun(run)}` : "Nu a rulat nicio actualizare încă.", SYNC_BUTTON);
}

// Meniul „Menu” de lângă câmpul de mesaj (lista de comenzi cu descrieri).
const PUBLIC_COMMANDS = [
  { command: "start", description: "Cum folosești botul" },
  { command: "help", description: "Exemple de liste de cumpărături" },
  { command: "scurt", description: "Doar totalurile: /scurt lapte, paine" },
];
const OWNER_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: "actualizeaza", description: "Actualizează prețurile din magazine" },
  { command: "status", description: "Starea ultimei actualizări" },
  { command: "id", description: "Id-ul acestui chat" },
];
let menuReady = false; // o dată pe instanță; setarea e idempotentă, deci repetarea nu strică

async function ensureMenu(env: Env): Promise<void> {
  if (menuReady) return;
  menuReady = true;
  await telegram(env, "setMyCommands", { commands: PUBLIC_COMMANDS });
  await telegram(env, "setChatMenuButton", { menu_button: { type: "commands" } });
  if (env.OWNER_CHAT_ID) {
    await telegram(env, "setMyCommands", {
      commands: OWNER_COMMANDS,
      scope: { type: "chat", chat_id: Number(env.OWNER_CHAT_ID) },
    });
  }
}

async function handle(env: Env, chatId: number, text: string): Promise<void> {
  await ensureMenu(env);
  const command = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text);
  let details = true;
  let body = text;
  if (command) {
    const [, name, rest] = command;
    if (name === "start" || name === "help") {
      return void (await send(env, chatId, HELP, isOwner(env, chatId) ? SYNC_BUTTON : undefined));
    }
    if (name === "id") return void (await send(env, chatId, `Id-ul acestui chat: <code>${chatId}</code>`));
    if (name === "actualizeaza") return void (await startSync(env, chatId));
    if (name === "status") return void (await showStatus(env, chatId));
    if (name !== "scurt") return void (await send(env, chatId, "Comandă necunoscută. Scrie /help."));
    if (!rest.trim()) return void (await send(env, chatId, "Scrie lista după comandă, ex.:\n<code>/scurt lapte 1l, paine</code>"));
    details = false;
    body = rest;
  }
  if (body.length > 2000) return void (await send(env, chatId, "Lista e prea lungă."));

  await telegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
  const items = await parseList(body, env);
  if (!items.length) return void (await send(env, chatId, "Nu am găsit produse în mesaj. Scrie /help pentru exemple."));
  const report = await buildReport(env, items, details);
  const note = items.length >= MAX_ITEMS ? `\n\n<i>Am luat în calcul primele ${MAX_ITEMS} produse.</i>` : "";
  for (const part of splitMessage(report + note)) await send(env, chatId, part);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Telegram trimite secretul setat la setWebhook; fără el, cererea nu vine de la Telegram.
    if (request.method === "POST" && url.pathname === "/webhook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = (await request.json()) as Update;
      const msg = update.message;
      const cb = update.callback_query;
      if (cb) {
        const chatId = cb.message?.chat.id;
        ctx.waitUntil(
          (async () => {
            await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
            if (cb.data === "sync" && chatId) await startSync(env, chatId);
          })().catch(async (e) => {
            console.error("callback a eșuat:", e);
            if (chatId) await send(env, chatId, "Nu am putut porni actualizarea (eroare GitHub). Încearcă mai târziu.");
          }),
        );
      } else if (msg?.text) {
        // răspundem imediat lui Telegram (altfel retrimite update-ul), iar lucrul real continuă în fundal
        ctx.waitUntil(
          handle(env, msg.chat.id, msg.text).catch(async (e) => {
            console.error("handle a eșuat:", e);
            await send(env, msg.chat.id, "A apărut o eroare. Încearcă din nou peste un minut.");
          }),
        );
      }
      return new Response("ok");
    }

    // Test local fără Telegram: GET /debug?list=lapte,paine (doar cu DEBUG=1 în .dev.vars)
    if (env.DEBUG === "1" && url.pathname === "/debug") {
      const items = await parseList((url.searchParams.get("list") ?? "").replace(/,/g, "\n"), env);
      return new Response(await buildReport(env, items, url.searchParams.get("scurt") !== "1"), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("Supermarket bot");
  },
} satisfies ExportedHandler<Env>;
