import { badgeSvg, loadBadge } from "@/lib/badge";

// /badge/github/<owner>/<repo>.svg is the badge image; /badge/github/<owner>/<repo> opens the latest report.
export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const svg = repo.endsWith(".svg");
  const name = svg ? repo.slice(0, -4) : repo;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return new Response("Not found", { status: 404 });

  const record = await loadBadge(`${owner}/${name}`);

  if (!svg) {
    return Response.redirect(new URL(record ? `/runs/${record.runId}` : "/", request.url), 307);
  }

  return new Response(badgeSvg(record), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // GitHub's image proxy honors this; a few minutes stale is fine for a badge
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
