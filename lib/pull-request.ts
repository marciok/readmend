import type { BrokenLink, Report } from "./report";

export interface PullRequestText {
  title: string;
  body: string;
}

type Located = BrokenLink & { page: string };

/**
 * A pull-request title and Markdown body a user can paste for the repo's maintainers: every
 * proposed fix grouped by file, then what still needs a decision. Plain template, no model call,
 * so it says exactly what the report says.
 */
export function buildPullRequest(report: Report, reportUrl: string | null): PullRequestText | null {
  const links: Located[] = report.broken.flatMap(({ page, links }) => links.map((l) => ({ ...l, page })));
  if (links.length === 0) return null;

  const fixed = links.filter((l) => l.suggestion?.url);
  const noReplacement = links.filter((l) => l.target !== undefined && l.suggestion && !l.suggestion.url);
  const unanswered = links.filter((l) => l.target !== undefined && !l.suggestion);
  const external = links.filter((l) => l.target === undefined);

  const where = report.cloneUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  const found = reportUrl ? `[ReadMend](${reportUrl})` : "ReadMend";
  const lines: string[] = [
    `This fixes ${plural(fixed.length, "broken link")} in the documentation of \`${where}\`` +
      `${report.readmePath.includes("/") ? ` (\`${report.readmePath}\` and the pages it links to)` : ""}.`,
    "",
    `The links were found by ${found}, which follows every page reachable from the README and checks internal ` +
      "links, heading anchors and external URLs. Each replacement was proposed by an agent that looked for the " +
      "moved file or renamed heading in the repository and its git history; please review before merging.",
  ];

  if (fixed.length > 0) {
    lines.push("", "## Fixes", "");
    for (const [page, pageLinks] of groupByPage(fixed)) {
      lines.push(`### \`${page}\``, "");
      for (const link of pageLinks) {
        const s = link.suggestion!;
        const caution = s.confidence === "low" || !s.verified ? " **(please verify)**" : "";
        lines.push(`- \`${link.url}\` → \`${s.url}\`${caution}`);
        lines.push(`  <sub>${s.confidence} confidence: ${oneLine(s.reason)}</sub>`);
      }
      lines.push("");
    }
  }

  const undecided = [...noReplacement, ...unanswered];
  if (undecided.length > 0) {
    lines.push("## Needs a decision", "", "No replacement was found for these; they may need to be removed or rewritten:", "");
    for (const link of undecided) {
      const why = link.suggestion ? oneLine(link.suggestion.reason) : link.reason;
      lines.push(`- \`${link.page}\`: \`${link.url}\` (${why})`);
    }
    lines.push("");
  }

  if (external.length > 0) {
    lines.push("## Broken external links", "");
    for (const link of external) lines.push(`- \`${link.page}\`: ${link.url} (${link.reason})`);
    lines.push("");
  }

  const title =
    fixed.length > 0
      ? `docs: fix ${plural(fixed.length, "broken link")}`
      : `docs: ${plural(links.length, "broken link")} to review`;

  return { title, body: lines.join("\n").trimEnd() + "\n" };
}

function groupByPage(links: Located[]): Map<string, Located[]> {
  const groups = new Map<string, Located[]>();
  for (const link of links) groups.set(link.page, [...(groups.get(link.page) ?? []), link]);
  return groups;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
