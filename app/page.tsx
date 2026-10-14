import { RepoForm } from "@/components/repo-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-10 px-4 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">README link checker</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Paste a repository or docs folder. We clone it in a Vercel Sandbox, follow every page linked from its
          README, and check internal links, heading anchors and external URLs.
        </p>
      </div>
      <RepoForm />
    </main>
  );
}
