import { RepoForm } from "@/components/repo-form";

const STEPS = [
  {
    title: "Crawl in a sandbox",
    body: "The repository is cloned in a throwaway Vercel Sandbox. Every page reachable from the README is followed.",
  },
  {
    title: "Check every link",
    body: "Internal links and heading anchors are verified against the repo; external URLs are requested in parallel.",
  },
  {
    title: "Propose fixes with eve",
    body: "An eve agent investigates each broken link in the repo's history and proposes the link it should be.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="relative overflow-hidden border-b bg-background">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 pb-20 pt-24 text-center">
          <span className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs text-muted">
            <span className="size-1.5 rounded-full bg-success" />
            Durable runs on Vercel Workflow
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tighter sm:text-6xl">
            Find and mend broken links in your docs.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Paste a repository or docs folder. ReadMend checks every link reachable from its README and proposes the
            right one for each broken link.
          </p>
          <div className="mt-10 w-full max-w-xl text-left">
            <RepoForm />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-16">
        <div className="grid divide-y overflow-hidden rounded-lg border bg-background sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col gap-2 p-6">
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
              <h2 className="font-semibold tracking-tight">{step.title}</h2>
              <p className="text-sm leading-6 text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
