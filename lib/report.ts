import { siteRoute, type Link } from "./links";
import type { PullRequestText } from "./pull-request";
import type { Suggestion } from "./suggest";

export interface Page {
  path: string;
  anchors: string[];
  links: Link[];
}

export interface Target {
  exists: boolean;
  dir: boolean;
  /** Heading anchors when the target is a markdown file, otherwise null. */
  anchors: string[] | null;
}

export interface CrawlResult {
  repo: string;
  cloneUrl: string;
  ref: string | null;
  scope: string;
  readmePath: string;
  truncated: boolean;
  pages: Page[];
  targets: Record<string, Target>;
  /** Every markdown file in the repo, to check the paths the agent proposes. */
  markdownFiles: string[];
}

export type SourcedLink = Link & { source: string };

export interface Categorized {
  anchors: SourcedLink[];
  internal: SourcedLink[];
  external: SourcedLink[];
}

export interface ExternalLink {
  checkUrl: string;
  url: string;
  text: string | null;
  sources: string[];
}

export interface ExternalCheck extends ExternalLink {
  /** true: reachable; false: definitely gone; null: couldn't tell (auth walls, rate limits, 5xx) */
  exists: boolean | null;
  status: number | null;
  error: string | null;
}

export interface InternalCheck extends SourcedLink {
  /** true: works; false: broken; null: can't tell from the repo alone */
  ok: boolean | null;
  reason: string | null;
}

export interface BrokenLink {
  url: string;
  text: string | null;
  reason: string;
  /** Internal links only: what the link resolved to, used to match suggestions. */
  target?: string | null;
  fragment?: string | null;
  suggestion?: Suggestion;
}

export interface FixStatus {
  status: "none-needed" | "done" | "failed";
  message: string | null;
}

export interface UnknownLink {
  url: string;
  pages: string[];
  reason: string;
}

export interface Report {
  repo: string;
  cloneUrl: string;
  ref: string | null;
  readmePath: string;
  truncated: boolean;
  totals: {
    pages: number;
    internalChecked: number;
    internalBroken: number;
    internalUnknown: number;
    externalChecked: number;
    externalBroken: number;
    externalUnknown: number;
  };
  broken: { page: string; links: BrokenLink[] }[];
  unknown: UnknownLink[];
  fixes: FixStatus;
  /** Ready-to-paste PR text for the maintainers; null when nothing is broken. */
  pullRequest: PullRequestText | null;
}

export function categorize(crawl: CrawlResult): Categorized {
  const links = crawl.pages.flatMap((page) => page.links.map((l) => ({ ...l, source: page.path })));
  return {
    anchors: links.filter((l) => l.kind === "anchor"),
    internal: links.filter((l) => l.kind === "internal"),
    external: links.filter((l) => l.kind === "external"),
  };
}

// Internal links are checked against what crawlDocs saw in the clone: no HTTP needed.
export function checkInternal(crawl: CrawlResult, categorized: Categorized): InternalCheck[] {
  const anchorsByPath = new Map<string, string[]>();
  for (const [p, t] of Object.entries(crawl.targets)) if (t.anchors) anchorsByPath.set(p, t.anchors);
  for (const page of crawl.pages) anchorsByPath.set(page.path, page.anchors);

  return [...categorized.anchors, ...categorized.internal].map((link) => ({
    ...link,
    ...checkInternalLink(link, crawl.targets, anchorsByPath, crawl.scope),
  }));
}

function checkInternalLink(
  link: SourcedLink,
  targets: Record<string, Target>,
  anchors: Map<string, string[]>,
  scope: string,
): { ok: boolean | null; reason: string | null } {
  const { kind, target, fragment, url } = link;
  if (target === null) return { ok: false, reason: "points outside the repository" };

  const missing = kind === "internal" && targets[target]?.exists !== true;
  if (missing && siteRoute(url, scope)) {
    return { ok: null, reason: `${url} is outside ${scope}/ and not in the repo; may be a site route` };
  }
  if (missing) return { ok: false, reason: `${target} does not exist` };
  if (!fragment) return { ok: true, reason: null };

  // folders, images, source files: GitHub fragments like #L10 can't be verified here
  const targetAnchors = anchors.get(target);
  if (!targetAnchors || targetAnchors.includes(fragment.toLowerCase())) return { ok: true, reason: null };
  return { ok: false, reason: `no heading for #${fragment} in ${target}` };
}

export function buildReport(crawl: CrawlResult, internal: InternalCheck[], external: ExternalCheck[]): Report {
  const brokenInternal = internal
    .filter((l) => l.ok === false)
    .map((l) => ({
      page: l.source,
      url: l.url,
      text: l.text,
      reason: l.reason ?? "broken",
      target: l.target,
      fragment: l.fragment,
    }));

  const brokenExternal = external
    .filter((l) => l.exists === false)
    .flatMap((l) => l.sources.map((page) => ({ page, url: l.url, text: l.text, reason: `HTTP ${l.status}` })));

  const unknownInternal = [...groupBy(internal.filter((l) => l.ok === null), (l) => l.url)].map(
    ([url, links]) => ({ url, pages: uniq(links.map((l) => l.source)), reason: links[0].reason ?? "unknown" }),
  );
  const unknownExternal = external
    .filter((l) => l.exists === null)
    .map((l) => ({ url: l.url, pages: l.sources, reason: l.error ?? `HTTP ${l.status}` }));

  const allBroken: (BrokenLink & { page: string })[] = [...brokenInternal, ...brokenExternal];
  const broken = [...groupBy(allBroken, (l) => l.page)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([page, links]) => ({
      page,
      links: links.map(({ url, text, reason, target, fragment }): BrokenLink => ({ url, text, reason, target, fragment })),
    }));

  return {
    repo: crawl.repo,
    cloneUrl: crawl.cloneUrl,
    ref: crawl.ref,
    readmePath: crawl.readmePath,
    truncated: crawl.truncated,
    totals: {
      pages: crawl.pages.length,
      internalChecked: internal.length,
      internalBroken: brokenInternal.length,
      internalUnknown: internal.filter((l) => l.ok === null).length,
      externalChecked: external.length,
      externalBroken: external.filter((l) => l.exists === false).length,
      externalUnknown: unknownExternal.length,
    },
    broken,
    unknown: [...unknownInternal, ...unknownExternal],
    fixes: { status: "none-needed", message: null },
    pullRequest: null,
  };
}

// HEAD first; fall back to GET since many servers reject or mishandle HEAD.
export async function probe(url: string): Promise<Pick<ExternalCheck, "exists" | "status" | "error">> {
  try {
    let status = await request("HEAD", url);
    if (!(status >= 200 && status < 400) && status !== 404 && status !== 410) status = await request("GET", url);
    return { exists: existsFor(status), status, error: null };
  } catch (error) {
    return { exists: null, status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function request(method: "HEAD" | "GET", url: string): Promise<number> {
  const res = await fetch(url, {
    method,
    redirect: "follow",
    headers: { "user-agent": "readmend-link-checker" },
    signal: AbortSignal.timeout(10_000),
  });
  await res.body?.cancel();
  return res.status;
}

function existsFor(status: number): boolean | null {
  if (status >= 200 && status < 400) return true;
  if (status === 404 || status === 410) return false;
  return null;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  return groups;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
