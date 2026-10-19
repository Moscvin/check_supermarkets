// Pornește și urmărește workflow-ul „Actualizare prețuri” din GitHub Actions (scraperele rulează acolo, nu în Worker).
import type { Env } from "./types";

const WORKFLOW = "update-prices.yml";

export interface Run {
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  createdAt: string;
  url: string;
}

async function gh(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${(env.GITHUB_TOKEN ?? "").trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "supermarket-bot",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
}

export async function latestRun(env: Env): Promise<Run | null> {
  const res = await gh(env, `/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { workflow_runs: { status: string; conclusion: string | null; created_at: string; html_url: string }[] };
  const r = data.workflow_runs[0];
  return r ? { status: r.status, conclusion: r.conclusion, createdAt: r.created_at, url: r.html_url } : null;
}

export async function dispatch(env: Env): Promise<void> {
  const res = await gh(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  });
  if (res.status !== 204) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
