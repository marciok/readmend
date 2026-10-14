import { getVercelOidcToken } from "@vercel/oidc";
import { Client } from "eve/client";
import path from "node:path/posix";
import { z } from "zod";
import type { InternalCheck } from "./report";

/** One distinct broken target, with every place it is linked from. */
export interface Problem {
  id: string;
  target: string | null;
  fragment: string | null;
  reason: string;
  links: { page: string; url: string }[];
}

export const fixesSchema = z.object({
  fixes: z.array(
    z.object({
      id: z.string(),
      target: z.string().nullable(),
      fragment: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
    }),
  ),
});
export type Fix = z.infer<typeof fixesSchema>["fixes"][number];

export interface Suggestion {
  /** The replacement for the link as written on that page, or null when there's no good replacement. */
  url: string | null;
  target: string | null;
  confidence: Fix["confidence"];
  reason: string;
  /** The proposed file is in the repo (checked against the crawl, not just the agent's word). */
  verified: boolean;
}

/** Groups broken internal links by what they point at, so each is investigated once. */
export function collectProblems(internal: InternalCheck[]): Problem[] {
  const problems = new Map<string, Problem>();
  for (const link of internal) {
    if (link.ok !== false) continue;
    const key = `${link.target ?? link.url}#${link.fragment ?? ""}`;
    const problem = problems.get(key) ?? {
      id: `p${problems.size + 1}`,
      target: link.target,
      fragment: link.fragment || null,
      reason: link.reason ?? "broken",
      links: [],
    };
    problem.links.push({ page: link.source, url: link.url });
    problems.set(key, problem);
  }
  return [...problems.values()];
}

export function problemKey(link: { target?: string | null; url: string; fragment?: string | null }) {
  return `${link.target ?? link.url}#${link.fragment || ""}`;
}

/**
 * Rewrites a fix as a link in the same style the author used on that page: root-relative or
 * relative, with or without the file extension (docs sites drop it), "./" kept when it was there.
 * When the file was right and only the heading was wrong, the original path is kept as written.
 * A link to a folder that GitHub renders through its README.md has no extension for a different
 * reason (GitHub-style, not docs-site style), so the extension is kept then.
 */
export function proposeUrl(original: string, page: string, originalTarget: string | null, fix: Fix): string | null {
  if (!fix.target) return null;
  const fragment = fix.fragment ? `#${fix.fragment}` : "";
  const originalPath = original.split("#")[0].split("?")[0];

  if (fix.target === originalTarget) return `${originalPath}${fragment}` || null;

  const viaFolderReadme =
    originalTarget !== null &&
    /(^|\/)readme\.(md|markdown)$/i.test(originalTarget) &&
    !/readme(\.(md|markdown))?$/i.test(originalPath);
  const keepExtension = viaFolderReadme || /\.(md|mdx|markdown)$/i.test(originalPath);
  const target = keepExtension
    ? fix.target
    : fix.target.replace(/\.(mdx?|markdown)$/i, "").replace(/\/(index|readme)$/i, "");

  if (originalPath.startsWith("/")) return `/${target}${fragment}`;

  let relative = path.relative(path.dirname(page), target) || path.basename(target);
  if (!relative.startsWith(".") && originalPath.startsWith("./")) relative = `./${relative}`;
  return `${relative}${fragment}`;
}

// The agent is mounted by withEve() on this same deployment. On Vercel the deployment URL is behind
// Vercel Authentication, which the client passes with the deployment's OIDC token.
function eveClient() {
  const host =
    process.env.EVE_HOST ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT ?? 3000}`);
  return new Client({
    host,
    redirect: "error",
    ...(process.env.VERCEL ? { auth: { vercelOidc: { token: () => getVercelOidcToken() } } } : {}),
  });
}

export async function startSession(message: string): Promise<string> {
  const { session } = await eveClient().sessions.create({ message, outputSchema: fixesSchema });
  return session.state.sessionId;
}

export type PollResult =
  | { done: false }
  | { done: true; fixes: Fix[]; error: null }
  | { done: true; fixes: []; error: string };

/** Reads the session's recorded events so far; done once its turn has completed or failed. */
export async function pollSession(sessionId: string): Promise<PollResult> {
  const { events } = await eveClient().sessions.attach(sessionId).snapshot();
  let result: unknown;
  for (const event of events) {
    if (event.type === "result.completed") result = event.data.result;
    if (event.type === "turn.failed" || event.type === "session.failed") {
      return { done: true, fixes: [], error: "message" in event.data ? String(event.data.message) : event.type };
    }
    if (event.type === "turn.completed") {
      const parsed = fixesSchema.safeParse(result);
      return parsed.success
        ? { done: true, fixes: parsed.data.fixes, error: null }
        : { done: true, fixes: [], error: "the agent did not return fixes in the expected shape" };
    }
  }
  return { done: false };
}

/** Retires the session so eve can release its sandbox. */
export async function endSession(sessionId: string): Promise<void> {
  await eveClient().sessions.attach(sessionId).reset({ reason: "ReadMend got its answer" });
}
