// Worker Cloudflare: webhook Telegram → listă (LLM) → căutare în D1 → raport.
import { MAX_ITEMS, parseList } from "./list";
import { buildReport, splitMessage } from "./report";
import type { Env } from "./types";

const HELP = `Trimite-mi lista de cumpărături, <b>scrisă cum vrei</b>:

<code>lapte 2.5% 1l, 2 pâini, roșii 1kg, ulei de floarea soarelui, 10 ouă</code>

Îți spun cât costă în fiecare magazin (Linella, Family Market, Metro, Bonus), unde e cel mai ieftin și cât economisești dacă împarți coșul.

Pune cantitatea (<code>1l</code>, <code>500g</code>, <code>1kg</code>) pentru o comparație corectă; <code>x2</code> = două bucăți.
/scurt + listă = doar totalurile, fără detalii.`;

interface Update {
  message?: { chat: { id: number }; text?: string; message_id: number };
}

async function telegram(env: Env, method: string, body: object): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`Telegram ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const send = (env: Env, chat_id: number, text: string) =>
  telegram(env, "sendMessage", {
    chat_id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
  });

async function handle(env: Env, chatId: number, text: string): Promise<void> {
  const command = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text);
  let details = true;
  let body = text;
  if (command) {
    const [, name, rest] = command;
    if (name === "start" || name === "help") return void (await send(env, chatId, HELP));
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
      if (msg?.text) {
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
