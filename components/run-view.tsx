"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunStatusResponse } from "@/app/api/runs/[id]/route";
import { newIssueUrl } from "@/lib/issue";
import type { PullRequestText } from "@/lib/pull-request";
import type { BrokenLink, Report } from "@/lib/report";
import type { Suggestion } from "@/lib/suggest";
import type { ProgressEvent } from "@/workflows/readme-links";

const TERMINAL = ["completed", "failed", "cancelled"];

const STATUS = {
  pending: { label: "Queued", dot: "bg-faint", text: "text-muted" },
  running: { label: "Running", dot: "bg-warning animate-pulse", text: "text-warning" },
  completed: { label: "Ready", dot: "bg-success", text: "text-success" },
  failed: { label: "Error", dot: "bg-error", text: "text-error" },
  cancelled: { label: "Canceled", dot: "bg-faint", text: "text-muted" },
} as const;

// Before the first status poll returns we don't know the state yet; don't claim "Queued".
const LOADING = { label: "Loading", dot: "bg-faint animate-pulse", text: "text-muted" } as const;

export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunStatusResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const searchParams = useSearchParams();
  const finished = run !== null && TERMINAL.includes(run.status);
  const events = useProgress(runId, finished);

  // The report and final status come from polling: a failed run never closes its progress stream.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (cancelled) return;
      if (res.status === 404) return setNotFound(true);
      const data: RunStatusResponse = await res.json();
      setRun(data);
      if (!TERMINAL.includes(data.status)) timer = setTimeout(poll, 2000);
    }

    poll().catch(() => (timer = setTimeout(poll, 4000)));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (notFound) {
    return (
      <div className="rounded-lg border bg-background p-10 text-center">
        <p className="font-medium">This run doesn&apos;t exist.</p>
        <Link href="/" className="mt-3 inline-block text-sm text-accent hover:underline">
          Start a new check
        </Link>
      </div>
    );
  }

  // the form passes the URL along so the header has it before the report exists
  const repo = run?.report?.repo ?? searchParams.get("repo") ?? runId;
  const status = run ? STATUS[run.status] : LOADING;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight" title={repo}>
          {repo.replace(/^https?:\/\/github\.com\//, "")}
        </h1>
        <StatusBadge status={status} />
      </div>

      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border bg-background sm:grid-cols-4 sm:divide-x">
        <Meta label="Repository">
          <a href={repo} target="_blank" rel="noreferrer" className="block truncate hover:underline">
            {repo.replace(/^https?:\/\//, "")}
          </a>
        </Meta>
        <Meta label="Status">
          <span className={`flex items-center gap-2 ${status.text}`}>
            <span className={`size-2 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </Meta>
        <Meta label="Duration">
          <Duration from={run?.createdAt} to={run?.completedAt} />
        </Meta>
        <Meta label="Run">
          <span className="block truncate font-mono text-xs" title={runId}>
            {runId}
          </span>
        </Meta>
      </dl>

      {run?.status === "failed" && (
        <div id="run-error" role="alert" className="rounded-lg border border-error/30 bg-error-bg p-4 text-sm text-error">
          <p className="font-medium">The check failed</p>
          <p className="mt-1 break-words font-mono text-xs">{run.error}</p>
        </div>
      )}

      {run?.report && <ReportView report={run.report} />}

      <LogPanel events={events} running={!finished} collapsible={Boolean(run?.report)} />
    </div>
  );
}

/** Reads the run's NDJSON progress stream, reconnecting from the last event until the run ends. */
function useProgress(runId: string, finished: boolean) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const count = useRef(0);
  const finishedRef = useRef(finished);
  useEffect(() => {
    finishedRef.current = finished;
  }, [finished]);

  useEffect(() => {
    const controller = new AbortController();

    async function follow() {
      while (!controller.signal.aborted && !finishedRef.current) {
        try {
          const res = await fetch(`/api/runs/${runId}/events?startIndex=${count.current}`, { signal: controller.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            buffer += value;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            const parsed = lines.filter(Boolean).map((line) => JSON.parse(line) as ProgressEvent);
            count.current += parsed.length;
            setEvents((prev) => [...prev, ...parsed]);
          }
        } catch {
          if (controller.signal.aborted) return;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    follow();
    return () => controller.abort();
  }, [runId]);

  return events;
}

function StatusBadge({ status: s }: { status: { label: string; dot: string } }) {
  return (
    <span id="run-status" className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs font-medium">
      <span className={`size-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 p-4 max-sm:border-b max-sm:odd:border-r max-sm:[&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Duration({ from, to }: { from?: string; to?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to || !from) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [from, to]);

  if (!from) return <span className="text-muted">—</span>;
  const ms = (to ? Date.parse(to) : now) - Date.parse(from);
  const seconds = Math.max(0, Math.round(ms / 1000));
  return <span className="tabular-nums">{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</span>;
}

function LogPanel({ events, running, collapsible }: { events: ProgressEvent[]; running: boolean; collapsible: boolean }) {
  const [open, setOpen] = useState(false);
  const end = useRef<HTMLLIElement>(null);
  const expanded = open || !collapsible;
  useEffect(() => {
    if (expanded) end.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, expanded]);

  return (
    <section className="overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`flex w-full items-center justify-between px-4 py-3 text-sm ${collapsible ? "hover:bg-hover" : "cursor-default"}`}
      >
        <span className="flex items-center gap-2 font-medium">
          {collapsible && <span className={`text-faint transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>}
          Logs
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {running && <span className="size-3 animate-spin rounded-full border-2 border-border border-t-foreground" />}
          {events.length} lines
        </span>
      </button>
      {expanded && (
        <ol id="progress-log" className="max-h-[28rem] overflow-y-auto border-t bg-background-subtle py-2 font-mono text-[12.5px] leading-6">
          {events.length === 0 && <li className="px-4 text-muted">Starting a sandbox and cloning the repository…</li>}
          {events.map((event, i) => (
            <li key={i} ref={i === events.length - 1 ? end : undefined} className="flex gap-4 px-4 hover:bg-hover">
              <span className="shrink-0 tabular-nums text-faint">{event.at.slice(11, 23)}</span>
              <span className={`w-20 shrink-0 ${event.stage === "fix" ? "text-accent" : "text-muted"}`}>{event.stage}</span>
              <span className={`min-w-0 break-all ${logTone(event.message)}`}>{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function logTone(message: string) {
  if (message.startsWith("broken")) return "text-error";
  if (message.startsWith("unknown")) return "text-warning";
  return "";
}

function ReportView({ report }: { report: Report }) {
  const { totals } = report;
  const brokenCount = totals.internalBroken + totals.externalBroken;
  const fixedCount = report.broken.flatMap((p) => p.links).filter((l) => l.suggestion?.url).length;
  const github = /^https?:\/\/github\.com\/[^/]+\/[^/]+$/.test(report.cloneUrl) ? report.cloneUrl : null;
  const fileUrl = (page: string) => (github ? `${github}/blob/${report.ref ?? "HEAD"}/${page}` : null);
  // the report only renders after the first client-side poll, so window is available here
  const issueUrl = newIssueUrl(report, `${window.location.origin}${window.location.pathname}`);

  return (
    <div id="report" className="flex flex-col gap-10">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pages crawled" value={totals.pages} />
        <Stat label="Broken links" value={brokenCount} tone={brokenCount > 0 ? "error" : "success"} />
        <Stat
          label="Fixes proposed"
          value={fixedCount}
          tone={fixedCount > 0 ? "success" : undefined}
          detail={brokenCount ? `of ${brokenCount} broken` : undefined}
        />
        <Stat
          label="Links checked"
          value={totals.internalChecked + totals.externalChecked}
          detail={`${totals.internalChecked} internal · ${totals.externalChecked} external`}
        />
      </dl>

      {report.truncated && (
        <Notice>The crawl stopped at the page limit. Raise &ldquo;Max pages&rdquo; to check the rest.</Notice>
      )}

      {report.pullRequest && <PullRequestPanel pr={report.pullRequest} />}

      <section id="broken-links" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading title="Broken links" count={brokenCount} />
          {issueUrl && (
            <a
              id="open-issue"
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85"
            >
              Open issue on GitHub ↗
            </a>
          )}
        </div>
        {report.fixes.status === "failed" && <Notice>Couldn&apos;t get proposed fixes from eve: {report.fixes.message}</Notice>}
        {report.broken.length === 0 ? (
          <div className="rounded-lg border bg-background p-10 text-center text-sm text-muted">
            <span className="mx-auto mb-3 flex size-8 items-center justify-center rounded-full bg-success-bg text-success">✓</span>
            No broken links found.
          </div>
        ) : (
          report.broken.map(({ page, links }) => (
            <article key={page} className="overflow-hidden rounded-lg border bg-background">
              <header className="flex items-center justify-between gap-3 border-b bg-background-subtle px-4 py-2.5">
                <h3 className="flex min-w-0 items-center gap-2 font-mono text-[13px]">
                  <FileIcon />
                  <span className="truncate">{page}</span>
                </h3>
                {fileUrl(page) && (
                  <a
                    href={fileUrl(page)!}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 shrink-0 items-center rounded-md border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-hover"
                  >
                    View file ↗
                  </a>
                )}
              </header>
              <ul className="divide-y">
                {links.map((link, i) => (
                  <BrokenLinkRow key={i} link={link} />
                ))}
              </ul>
            </article>
          ))
        )}
      </section>

      {report.unknown.length > 0 && (
        <section id="unknown-links" className="flex flex-col gap-4">
          <SectionHeading title="Couldn't verify" count={report.unknown.length} />
          <ul className="divide-y overflow-hidden rounded-lg border bg-background">
            {report.unknown.map((link) => (
              <li key={link.url} className="flex flex-col gap-1 px-4 py-3">
                <code className="break-all font-mono text-[13px]">{link.url}</code>
                <span className="text-xs text-muted">
                  {link.reason} · linked from {link.pages.length} page{link.pages.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BrokenLinkRow({ link }: { link: BrokenLink }) {
  const suggestion = link.suggestion;
  return (
    <li className="flex flex-col gap-2.5 px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {link.text && <span className="text-sm font-medium">{link.text}</span>}
        <span className="text-xs text-muted">{link.reason}</span>
      </div>

      <div className="overflow-hidden rounded-md border font-mono text-[12.5px] leading-6">
        <div className="flex gap-3 bg-error-bg px-3 text-error">
          <span className="select-none">−</span>
          <span className="break-all">{link.url}</span>
        </div>
        {suggestion?.url && (
          <div className="flex gap-3 border-t bg-success-bg px-3 text-success">
            <span className="select-none">+</span>
            <span className="break-all">{suggestion.url}</span>
          </div>
        )}
      </div>

      {suggestion && <SuggestionMeta suggestion={suggestion} />}
    </li>
  );
}

function SuggestionMeta({ suggestion }: { suggestion: Suggestion }) {
  const tone = {
    high: "border-success/30 bg-success-bg text-success",
    medium: "border-warning/30 bg-warning-bg text-warning",
    low: "bg-background-subtle text-muted",
  }[suggestion.confidence];

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-accent">
          <SparkIcon /> Proposed by eve
        </span>
        <span className={`rounded-full border px-2 py-px font-medium ${tone}`}>{suggestion.confidence} confidence</span>
        {suggestion.url && !suggestion.verified && <span className="text-warning">target not found in the repo</span>}
        {!suggestion.url && <span className="text-muted">No good replacement: consider removing the link.</span>}
      </div>
      <p className="leading-5 text-muted">{suggestion.reason}</p>
    </div>
  );
}

function PullRequestPanel({ pr }: { pr: PullRequestText }) {
  return (
    <section id="pull-request" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Pull request</h2>
        <CopyButton id="copy-pr" text={`${pr.title}\n\n${pr.body}`} label="Copy all" primary />
      </div>
      <p className="-mt-2 text-sm text-muted">
        Ready to paste into a pull request for the repository&apos;s maintainers, once the fixes are applied.
      </p>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">Title</p>
            <p id="pr-title" className="truncate text-sm font-medium">{pr.title}</p>
          </div>
          <CopyButton text={pr.title} label="Copy" />
        </div>
        <div className="flex items-center justify-between gap-3 border-b bg-background-subtle px-4 py-2">
          <p className="text-xs text-muted">Description · Markdown</p>
          <CopyButton text={pr.body} label="Copy" />
        </div>
        <pre id="pr-body" className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12.5px] leading-6">
          {pr.body}
        </pre>
      </div>
    </section>
  );
}

function CopyButton({ text, label, id, primary }: { text: string; label: string; id?: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      id={id}
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
      className={
        primary
          ? "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85"
          : "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-hover"
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      {title}
      <span className="rounded-full border bg-background px-2 text-xs font-medium tabular-nums text-muted">{count}</span>
    </h2>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: number; detail?: string; tone?: "success" | "error" }) {
  const color = tone === "error" ? "text-error" : tone === "success" ? "text-success" : "";
  return (
    <div className="rounded-lg border bg-background p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</dd>
      {detail && <dd className="mt-0.5 text-xs text-muted">{detail}</dd>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">{children}</p>;
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M9 1.5H4.5a1 1 0 00-1 1v11a1 1 0 001 1h7a1 1 0 001-1V5L9 1.5z" />
      <path d="M9 1.5V5h3.5" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
      <path d="M8 0l1.6 5.1L15 6.4l-4.4 2.9L11.7 15 8 11.7 4.3 15l1.1-5.7L1 6.4l5.4-1.3L8 0z" />
    </svg>
  );
}
