import { get, put } from "@vercel/blob";
import type { Report } from "./report";

/** The latest whole-repo result for one GitHub repo, which its badge shows. */
export interface BadgeRecord {
  repo: string;
  checked: number;
  broken: number;
  runId: string;
  checkedAt: string;
}

/** "owner/name" for a github.com clone URL, otherwise null: badges are GitHub-only. */
export function githubSlug(cloneUrl: string): string | null {
  const m = cloneUrl.replace(/\.git$/, "").match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

const pathname = (slug: string) => `badges/github/${slug}.json`;

export async function saveBadge(report: Report, runId: string): Promise<BadgeRecord | null> {
  const slug = githubSlug(report.cloneUrl);
  if (!slug) return null;
  const record: BadgeRecord = {
    repo: slug,
    checked: report.totals.internalChecked + report.totals.externalChecked,
    broken: report.totals.internalBroken + report.totals.externalBroken,
    runId,
    checkedAt: new Date().toISOString(),
  };
  await put(pathname(slug), JSON.stringify(record), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
  });
  return record;
}

export async function loadBadge(slug: string): Promise<BadgeRecord | null> {
  // skip the CDN cache: a re-check overwrites the same pathname
  const result = await get(pathname(slug.toLowerCase()), { access: "private", useCache: false });
  if (result?.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text()) as BadgeRecord;
}

const COLORS = { ok: "#2ea043", broken: "#cf222e", unknown: "#8b949e" };

/** A flat, shields.io-style badge: "doc links | 142/142 ok". */
export function badgeSvg(record: BadgeRecord | null): string {
  const label = "doc links";
  const [message, color] = !record
    ? ["not checked", COLORS.unknown]
    : record.broken === 0
      ? [`${record.checked}/${record.checked} ok`, COLORS.ok]
      : [`${record.broken} broken`, COLORS.broken];

  // Verdana 11px averages ~6.5px per character; close enough without measuring glyphs
  const width = (text: string) => Math.round(text.length * 6.5) + 12;
  const lw = width(label);
  const mw = width(message);
  const total = lw + mw;
  const title = record ? `${label}: ${message} (checked ${record.checkedAt.slice(0, 10)})` : `${label}: ${message}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escape(title)}">
<title>${escape(title)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="20" fill="#555"/>
<rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
<rect width="${total}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${escape(label)}</text>
<text x="${lw / 2}" y="14">${escape(label)}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${escape(message)}</text>
<text x="${lw + mw / 2}" y="14">${escape(message)}</text>
</g>
</svg>`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
