"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = ["https://github.com/vercel/eve/tree/main/docs"];

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
    <form id="repo-form" onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="repo" className="sr-only">
        Repository or docs folder URL
      </label>
      <div className="flex flex-col gap-2 rounded-xl border bg-background p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] sm:flex-row">
        <input
          id="repo"
          name="repo"
          type="url"
          required
          autoFocus
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="https://github.com/owner/name/tree/main/docs"
          className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-3 font-mono text-sm placeholder:text-faint"
        />
        <button
          id="start-check"
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60"
        >
          {submitting && <span className="size-3.5 animate-spin rounded-full border-2 border-background/30 border-t-background" />}
          {submitting ? "Starting" : "Check links"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Try</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setRepo(example)}
            className="inline-flex h-6 items-center rounded-full border bg-background px-2.5 font-mono transition-colors hover:border-border-strong hover:text-foreground"
          >
            {example.replace("https://github.com/", "")}
          </button>
        ))}
        <details className="ml-auto">
          <summary className="cursor-pointer select-none list-none rounded-md px-2 py-1 hover:bg-hover hover:text-foreground">
            Options
          </summary>
          <label className="absolute mt-2 flex items-center gap-2 rounded-lg border bg-background p-3 shadow-lg">
            <span className="whitespace-nowrap">Max pages</span>
            <input
              id="max-pages"
              type="number"
              min={1}
              max={1000}
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              className="focus-ring h-8 w-20 rounded-md border bg-background px-2 text-foreground"
            />
          </label>
        </details>
      </div>

      {error && (
        <p id="form-error" role="alert" className="rounded-lg border border-error/30 bg-error-bg px-3 py-2.5 text-sm text-error">
          {error}
        </p>
      )}
    </form>
  );
}
