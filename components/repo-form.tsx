"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = [
  "https://github.com/vercel/eve/tree/main/docs",
  "https://github.com/marciok/gust",
];

export function RepoForm() {
  const router = useRouter();
  const [repo, setRepo] = useState("");
  const [maxPages, setMaxPages] = useState("200");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, maxPages }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start the check");
      router.push(`/runs/${body.runId}?repo=${encodeURIComponent(repo.trim())}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <form id="repo-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      <label htmlFor="repo" className="text-sm font-medium">
        Repository or docs folder URL
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="repo"
          name="repo"
          type="url"
          required
          autoFocus
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="https://github.com/owner/name/tree/main/docs"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300"
        />
        <button
          id="start-check"
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {submitting ? "Starting…" : "Check links"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
        <span>Try:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setRepo(example)}
            className="rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          >
            {example.replace("https://github.com/", "")}
          </button>
        ))}
      </div>

      <details className="text-sm text-zinc-500">
        <summary className="cursor-pointer select-none">Options</summary>
        <label className="mt-3 flex items-center gap-3">
          <span>Maximum pages to crawl</span>
          <input
            id="max-pages"
            type="number"
            min={1}
            max={1000}
            value={maxPages}
            onChange={(e) => setMaxPages(e.target.value)}
            className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
      </details>

      {error && (
        <p id="form-error" role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
