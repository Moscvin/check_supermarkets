// Client LLM configurat din variabile de mediu: LLM_API_URL, LLM_MODEL (vars în wrangler.jsonc) și LLM_API_KEY (secret).
// Două formate: API-ul nativ Gemini (URL cu „:generateContent”, cheia în x-goog-api-key) și orice API compatibil
// OpenAI (Grok, Groq, Gemini /openai, ...) cu „Authorization: Bearer”.
import type { Env } from "./types";

const TIMEOUT_MS = 20_000; // Worker-ul are ~30 s după răspunsul către Telegram

/** Răspuns JSON de la model. Formatul cerut se descrie în prompt. */
export async function askLlm<T>(env: Env, system: string, user: string): Promise<T> {
  const key = (env.LLM_API_KEY ?? "").trim(); // un newline rămas la copiere strică headerul
  const native = env.LLM_API_URL.includes(":generateContent");

  const res = native
    ? await fetch(env.LLM_API_URL, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    : await fetch(env.LLM_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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

  const data = (await res.json()) as any;
  const content: string = native
    ? (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("")
    : data.choices[0].message.content;
  // unele modele învelesc JSON-ul în ```json ... ```
  return JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) as T;
}
