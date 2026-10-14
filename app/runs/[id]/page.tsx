import Link from "next/link";
import { Suspense } from "react";
import { RunView } from "@/components/run-view";

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Check another repository
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        {params.then(({ id }) => (
          <RunView runId={id} />
        ))}
      </Suspense>
    </main>
  );
}
