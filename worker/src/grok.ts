// Client minimal pentru API-ul xAI (compatibil OpenAI), cu răspuns JSON structurat.
import type { Env } from "./types";

const API_URL = "https://api.x.ai/v1/chat/completions";
const TIMEOUT_MS = 20_000; // Worker-ul are ~30 s după răspunsul către Telegram

export async function askGrok<T>(env: Env, system: string, user: string, name: string, schema: object): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.GROK_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, schema } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content) as T;
}
