import Link from "next/link";
import { Suspense } from "react";
import { RunView } from "@/components/run-view";

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10">
      <Link href="/" className="w-fit text-sm text-muted transition-colors hover:text-foreground">
        ← New check
      </Link>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg border bg-background" />}>
        {params.then(({ id }) => (
          <RunView runId={id} />
        ))}
      </Suspense>
    </main>
  );
}
