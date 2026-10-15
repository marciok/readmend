import type { BrokenLink, Report } from "./report";

// GitHub rejects very long new-issue URLs; stay well under its limit.
const MAX_URL_LENGTH = 7000;

/**
 * A GitHub "new issue" URL with the title and body prefilled from the report, or null when the
 * repo isn't on GitHub or nothing is broken. Opening it lets the user review and submit as themselves.
 */
export function newIssueUrl(report: Report, reportUrl: string | null): string | null {
  const repo = report.cloneUrl.replace(/\.git$/, "").match(/^https?:\/\/github\.com\/[^/]+\/[^/]+$/)?.[0];
  const links = report.broken.flatMap(({ page, links }) => links.map((link) => ({ ...link, page })));
  if (!repo || links.length === 0) return null;

  const title = `docs: ${plural(links.length, "broken link")} in the documentation`;
  // drop entries from the end until the URL fits, pointing at the full report for the rest
  for (let shown = links.length; shown >= 0; shown--) {
    const body = issueBody(report, links.slice(0, shown), links.length - shown, reportUrl);
    const url = `${repo}/issues/new?${new URLSearchParams({ title, body })}`;
    if (url.length <= MAX_URL_LENGTH) return url;
  }
  return `${repo}/issues/new?${new URLSearchParams({ title })}`;
}

function issueBody(report: Report, links: (BrokenLink & { page: string })[], hidden: number, reportUrl: string | null) {
  const found = reportUrl ? `[ReadMend](${reportUrl})` : "ReadMend";
  const lines = [
    `${found} found ${plural(links.length + hidden, "broken link")} in the pages reachable from \`${report.readmePath}\`.`,
    "",
  ];

  let page: string | null = null;
  for (const link of links) {
    if (link.page !== page) {
      if (page !== null) lines.push("");
      lines.push(`### \`${link.page}\``, "");
      page = link.page;
    }
    const fix = link.suggestion?.url ? ` → suggested: \`${link.suggestion.url}\`` : "";
    lines.push(`- \`${link.url}\` (${link.reason})${fix}`);
  }

  if (hidden > 0) {
    lines.push("", `…and ${plural(hidden, "more broken link")}${reportUrl ? `: see the [full report](${reportUrl})` : ""}.`);
  }
  return lines.join("\n");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
