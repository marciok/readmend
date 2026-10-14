import { FatalError, getWritable } from "workflow";
import { checkUrl, findReadme, parseSource } from "@/lib/links";
import { crawl, describeTargets, PermanentError, snapshotRepo } from "@/lib/crawl";
import {
  buildReport,
  categorize,
  checkInternal,
  probe,
  type Categorized,
  type CrawlResult,
  type ExternalCheck,
  type ExternalLink,
  type InternalCheck,
  type Report,
} from "@/lib/report";

export interface RunInput {
  repo: string;
  maxPages: number;
}

export interface ProgressEvent {
  at: string;
  stage: "crawl" | "categorize" | "external" | "internal" | "report";
  message: string;
}

// crawl → categorize → (external checks ‖ internal checks) → report
export async function readmeLinks(input: RunInput): Promise<Report> {
  "use workflow";

  const crawled = await crawlDocs(input);
  const { categorized, external } = await categorizeLinks(crawled);

  const [externalChecks, internalChecks] = await Promise.all([
    Promise.all(external.map((link) => checkLink(link))),
    checkInternalLinks(crawled, categorized),
  ]);

  return await finish(crawled, internalChecks, externalChecks);
}

// Clones in a Vercel Sandbox and follows relative links between markdown pages, starting at the
// README and staying inside the starting folder. Everything later steps need to judge internal
// links (pages, link targets, heading anchors) is captured here; the clone itself is discarded.
async function crawlDocs({ repo, maxPages }: RunInput): Promise<CrawlResult> {
  "use step";

  try {
    const source = parseSource(repo);
    const snapshot = await snapshotRepo(source, (msg) => emit("crawl", msg));

    if (!snapshot.dirs.has(source.dir)) throw new PermanentError(`${source.dir} is not a directory in ${source.cloneUrl}`);
    const readmePath = findReadme(snapshot, source.dir);
    if (!readmePath) throw new PermanentError(`no README found in ${repo}`);

    const { pages, truncated } = crawl(snapshot, source.dir, readmePath, maxPages);
    await emit(
      "crawl",
      `Crawled ${pages.length} pages from ${readmePath}${truncated ? ` (stopped at the ${maxPages}-page limit)` : ""}`,
    );

    return {
      repo,
      cloneUrl: source.cloneUrl,
      ref: source.ref,
      scope: source.dir,
      readmePath,
      truncated,
      pages,
      targets: describeTargets(snapshot, pages),
    };
  } catch (error) {
    if (error instanceof PermanentError) throw new FatalError(error.message);
    if (error instanceof Error && error.message.startsWith("invalid path")) throw new FatalError(error.message);
    throw error;
  }
}
crawlDocs.maxRetries = 2;

// The same URL is often linked from many pages (nav, footers); it's checked once and keeps its sources.
async function categorizeLinks(crawled: CrawlResult): Promise<{ categorized: Categorized; external: ExternalLink[] }> {
  "use step";

  const categorized = categorize(crawled);
  const external = new Map<string, ExternalLink>();
  for (const link of categorized.external) {
    const url = checkUrl(link.url);
    const entry = external.get(url) ?? { checkUrl: url, url: link.url, text: link.text, sources: [] };
    if (!entry.sources.includes(link.source)) entry.sources.push(link.source);
    external.set(url, entry);
  }

  await emit(
    "categorize",
    `${categorized.anchors.length} anchor, ${categorized.internal.length} internal and ` +
      `${categorized.external.length} external links (${external.size} unique URLs)`,
  );
  return { categorized, external: [...external.values()] };
}

async function checkLink(link: ExternalLink): Promise<ExternalCheck> {
  "use step";

  const result = await probe(link.checkUrl);
  const verdict = result.exists === true ? "ok" : result.exists === false ? "broken" : "unknown";
  await emit("external", `${verdict} ${result.status ?? result.error} ${link.url}`);
  return { ...link, ...result };
}

async function checkInternalLinks(crawled: CrawlResult, categorized: Categorized): Promise<InternalCheck[]> {
  "use step";

  const checks = checkInternal(crawled, categorized);
  await emit("internal", `${checks.filter((c) => c.ok === false).length} of ${checks.length} internal links broken`);
  return checks;
}

async function finish(crawled: CrawlResult, internal: InternalCheck[], external: ExternalCheck[]): Promise<Report> {
  "use step";

  const report = buildReport(crawled, internal, external);
  await emit("report", `Done: ${report.totals.internalBroken + report.totals.externalBroken} broken links`);
  await getWritable<ProgressEvent>().close();
  return report;
}

async function emit(stage: ProgressEvent["stage"], message: string) {
  const writer = getWritable<ProgressEvent>().getWriter();
  try {
    await writer.write({ at: new Date().toISOString(), stage, message });
  } finally {
    writer.releaseLock();
  }
}
