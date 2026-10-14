"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunStatusResponse } from "@/app/api/runs/[id]/route";
import type { Report } from "@/lib/report";
import type { ProgressEvent } from "@/workflows/readme-links";

const TERMINAL = ["completed", "failed", "cancelled"];

export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunStatusResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const searchParams = useSearchParams();
  const events = useProgress(runId, run !== null && TERMINAL.includes(run.status));

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
      <div className="rounded-xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <p className="font-medium">This run doesn&apos;t exist.</p>
        <Link href="/" className="mt-2 inline-block text-sm underline">
          Check another repository
        </Link>
      </div>
    );
  }

  // the form passes the URL along so the header has it before the report exists
  const repo = run?.report?.repo ?? searchParams.get("repo");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Link check</p>
          <h1 className="truncate font-mono text-lg" title={runId}>{repo ?? runId}</h1>
        </div>
        <StatusBadge status={run?.status ?? "pending"} />
      </header>

      {run?.status === "failed" && (
        <div id="run-error" role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">The check failed</p>
          <p className="mt-1 break-words font-mono text-xs">{run.error}</p>
        </div>
      )}

      {run?.report ? <ReportView report={run.report} /> : <ProgressLog events={events} />}

      {run?.report && (
        <details className="text-sm text-zinc-500">
          <summary className="cursor-pointer select-none">Progress log</summary>
          <div className="mt-3">
            <ProgressLog events={events} />
          </div>
        </details>
      )}
    </div>
  );
}

/** Reads the run's NDJSON progress stream, reconnecting from the last event until the run ends. */
function useProgress(runId: string, finished: boolean) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const count = useRef(0);
  const finishedRef = useRef(finished);
  finishedRef.current = finished;

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    running: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    failed: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span id="run-status" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${styles[status] ?? styles.pending}`}>
      {(status === "running" || status === "pending") && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  );
}

function ProgressLog({ events }: { events: ProgressEvent[] }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  if (events.length === 0) {
    return <p className="text-sm text-zinc-500">Starting a sandbox and cloning the repository…</p>;
  }

  return (
    <ol id="progress-log" className="max-h-96 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-6 dark:border-zinc-800 dark:bg-zinc-900">
      {events.map((event, i) => (
        <li key={i} ref={i === events.length - 1 ? end : undefined} className="flex gap-3">
          <span className="w-20 shrink-0 text-zinc-400">{event.stage}</span>
          <span className="break-all">{event.message}</span>
        </li>
      ))}
    </ol>
  );
}

function ReportView({ report }: { report: Report }) {
  const { totals } = report;
  const brokenCount = totals.internalBroken + totals.externalBroken;
  const github = report.cloneUrl.match(/^https?:\/\/github\.com\/[^/]+\/[^/]+$/) ? report.cloneUrl : null;
  const fileUrl = (page: string) => (github ? `${github}/blob/${report.ref ?? "HEAD"}/${page}` : null);

  return (
    <div id="report" className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pages crawled" value={totals.pages} />
        <Stat label="Broken links" value={brokenCount} tone={brokenCount > 0 ? "bad" : "good"} />
        <Stat label="Internal checked" value={totals.internalChecked} detail={`${totals.internalBroken} broken`} />
        <Stat label="External checked" value={totals.externalChecked} detail={`${totals.externalBroken} broken`} />
      </dl>

      {report.truncated && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          The crawl stopped at the page limit; raise &ldquo;Maximum pages&rdquo; to check the rest.
        </p>
      )}

      <section id="broken-links" className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Broken links</h2>
        {report.broken.length === 0 ? (
          <p className="text-sm text-zinc-500">No broken links found.</p>
        ) : (
          report.broken.map(({ page, links }) => (
            <article key={page} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <h3 className="truncate font-mono text-sm">{page}</h3>
                {fileUrl(page) && (
                  <a href={fileUrl(page)!} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100">
                    View file
                  </a>
                )}
              </header>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {links.map((link, i) => (
                  <li key={i} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <code className="break-all text-red-700 dark:text-red-400">{link.url}</code>
                    {link.text && <span className="text-zinc-500">&ldquo;{link.text}&rdquo;</span>}
                    <span className="text-xs text-zinc-500">{link.reason}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </section>

      {report.unknown.length > 0 && (
        <section id="unknown-links" className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Couldn&apos;t verify</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {report.unknown.map((link) => (
              <li key={link.url} className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <code className="break-all">{link.url}</code>
                <p className="mt-1 text-xs text-zinc-500">
                  {link.reason} · linked from {link.pages.length} page{link.pages.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: number; detail?: string; tone?: "good" | "bad" }) {
  const color = tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</dd>
      {detail && <dd className="text-xs text-zinc-500">{detail}</dd>}
    </div>
  );
}
