// Client pentru orice API compatibil OpenAI (Gemini, Grok, Groq, ...), configurat din variabile de mediu:
// LLM_API_URL, LLM_MODEL (vars în wrangler.jsonc) și LLM_API_KEY (secret).
import type { Env } from "./types";

const TIMEOUT_MS = 20_000; // Worker-ul are ~30 s după răspunsul către Telegram

/** Răspuns JSON de la model. Formatul cerut se descrie în prompt; „json_object” e înțeles de toți furnizorii. */
export async function askLlm<T>(env: Env, system: string, user: string): Promise<T> {
  const res = await fetch(env.LLM_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  // unele modele învelesc JSON-ul în ```json ... ```
  const text = data.choices[0].message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  return JSON.parse(text) as T;
}
