import { start } from "workflow/api";
import { readmeLinks } from "@/workflows/readme-links";

const DEFAULT_MAX_PAGES = 200;
const MAX_PAGES_LIMIT = 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const repo = typeof body?.repo === "string" ? body.repo.trim() : "";

  // https:// or git@ URLs only: anything else (local paths, "-flags") never reaches git
  if (!/^(https?:\/\/|git@)[^\s]+$/.test(repo)) {
    return Response.json(
      { error: "Enter a git repository URL, e.g. https://github.com/owner/name or a /tree/<branch>/<folder> link" },
      { status: 400 },
    );
  }

  const maxPages = body?.maxPages === undefined || body?.maxPages === "" ? DEFAULT_MAX_PAGES : Number(body.maxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_LIMIT) {
    return Response.json({ error: `maxPages must be a whole number between 1 and ${MAX_PAGES_LIMIT}` }, { status: 400 });
  }

  const run = await start(readmeLinks, [{ repo, maxPages }]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
