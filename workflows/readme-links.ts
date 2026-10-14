import { FatalError, getWorkflowMetadata, getWritable, sleep } from "workflow";
import { checkUrl, findReadme, isMarkdown, parseSource } from "@/lib/links";
import { buildPullRequest } from "@/lib/pull-request";
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
import {
  collectProblems,
  endSession,
  pollSession,
  problemKey,
  proposeUrl,
  startSession,
  type Fix,
  type PollResult,
  type Problem,
} from "@/lib/suggest";

export interface RunInput {
  repo: string;
  maxPages: number;
}

export interface ProgressEvent {
  at: string;
  stage: "crawl" | "categorize" | "external" | "internal" | "fix" | "report";
  message: string;
}

interface FixBatch {
  fixes: Fix[];
  error: string | null;
}

// crawl → categorize → (external checks ‖ internal checks) → eve proposes fixes → report → PR text
export async function readmeLinks(input: RunInput): Promise<Report> {
  "use workflow";

  const crawled = await crawlDocs(input);
  const { categorized, external } = await categorizeLinks(crawled);

  const [externalChecks, internalChecks] = await Promise.all([
    Promise.all(external.map((link) => checkLink(link))),
    checkInternalLinks(crawled, categorized),
  ]);

  const problems = await planFixes(internalChecks);
  const source = { cloneUrl: crawled.cloneUrl, ref: crawled.ref, scope: crawled.scope };
  const batches = await Promise.all(chunk(problems, FIX_BATCH_SIZE).map((batch) => askLinkDoctor(source, batch)));

  const report = await finish(crawled, internalChecks, externalChecks, problems, batches);
  return await writePullRequest(report, getWorkflowMetadata().workflowRunId);
}

const FIX_BATCH_SIZE = 10;
const FIX_POLL_INTERVAL = "10s";
const FIX_MAX_POLLS = 90; // 15 minutes

// An agent investigation can outlast a function's duration limit, so no step waits on it: one step
// starts the eve session, then the workflow sleeps durably between short polls.
async function askLinkDoctor(source: AgentSource, problems: Problem[]): Promise<FixBatch> {
  const sessionId = await startLinkDoctor(source, problems);
  if (!sessionId) return { fixes: [], error: "could not start the eve agent" };

  try {
    for (let i = 0; i < FIX_MAX_POLLS; i++) {
      await sleep(FIX_POLL_INTERVAL);
      const poll = await pollLinkDoctor(sessionId);
      if (poll.done) return { fixes: poll.fixes, error: poll.error };
    }
    return { fixes: [], error: "the eve agent did not answer within 15 minutes" };
  } finally {
    await endLinkDoctor(sessionId);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
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
      markdownFiles: [...snapshot.contents.keys()].filter(isMarkdown),
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

interface AgentSource {
  cloneUrl: string;
  ref: string | null;
  scope: string;
}

async function planFixes(internal: InternalCheck[]): Promise<Problem[]> {
  "use step";

  const problems = collectProblems(internal);
  if (problems.length > 0) {
    await emit("fix", `Asking eve to propose fixes for ${problems.length} broken targets`);
  }
  return problems;
}

// Failures in the fix steps never fail the run: the report is still useful without suggestions.
async function startLinkDoctor(source: AgentSource, problems: Problem[]): Promise<string | null> {
  "use step";

  const message =
    "Find the correct target for each broken link below and return your fixes.\n\n" +
    JSON.stringify({ repo: source.cloneUrl, ref: source.ref, scope: source.scope, problems }, null, 2);
  try {
    const sessionId = await startSession(message);
    await emit("fix", `eve session ${sessionId} is investigating ${problems.length} targets`);
    return sessionId;
  } catch (error) {
    await emit("fix", `Could not start the eve agent: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
startLinkDoctor.maxRetries = 2;

async function pollLinkDoctor(sessionId: string): Promise<PollResult> {
  "use step";

  try {
    const result = await pollSession(sessionId);
    if (result.done) {
      await emit("fix", result.error ? `eve failed: ${result.error}` : `eve proposed ${result.fixes.length} fixes`);
    }
    return result;
  } catch {
    return { done: false }; // transient: the next poll tries again
  }
}

async function endLinkDoctor(sessionId: string): Promise<void> {
  "use step";

  await endSession(sessionId).catch((error) => console.warn(`could not reset eve session ${sessionId}:`, error));
}

async function finish(
  crawled: CrawlResult,
  internal: InternalCheck[],
  external: ExternalCheck[],
  problems: Problem[],
  batches: FixBatch[],
): Promise<Report> {
  "use step";

  const report = buildReport(crawled, internal, external);

  const fixes = new Map(batches.flatMap((b) => b.fixes).map((fix) => [fix.id, fix]));
  const problemIds = new Map(problems.map((p) => [problemKey({ target: p.target, url: p.links[0].url, fragment: p.fragment }), p.id]));
  const markdownFiles = new Set(crawled.markdownFiles);
  for (const { page, links } of report.broken) {
    for (const link of links) {
      if (link.target === undefined) continue;
      const fix = fixes.get(problemIds.get(problemKey(link)) ?? "");
      if (!fix) continue;
      link.suggestion = {
        url: proposeUrl(link.url, page, link.target ?? null, fix),
        target: fix.target,
        confidence: fix.confidence,
        reason: fix.reason,
        verified: fix.target !== null && markdownFiles.has(fix.target),
      };
    }
  }

  const errors = batches.map((b) => b.error).filter((e): e is string => e !== null);
  report.fixes =
    problems.length === 0
      ? { status: "none-needed", message: null }
      : fixes.size === 0 && errors.length > 0
        ? { status: "failed", message: errors.join("; ") }
        : { status: "done", message: errors.length > 0 ? errors.join("; ") : null };

  return report;
}

// Last step: the text a user pastes into a pull request for the repo's maintainers.
async function writePullRequest(report: Report, runId: string): Promise<Report> {
  "use step";

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.PUBLIC_HOST;
  const reportUrl = host ? `https://${host}/runs/${runId}` : null;
  const pullRequest = buildPullRequest(report, reportUrl);

  await emit("report", pullRequest ? `Pull request text ready: "${pullRequest.title}"` : "No broken links: nothing to fix");
  await emit("report", `Done: ${report.totals.internalBroken + report.totals.externalBroken} broken links`);
  await getWritable<ProgressEvent>().close();
  return { ...report, pullRequest };
}

async function emit(stage: ProgressEvent["stage"], message: string) {
  const writer = getWritable<ProgressEvent>().getWriter();
  try {
    await writer.write({ at: new Date().toISOString(), stage, message });
  } finally {
    writer.releaseLock();
  }
}
