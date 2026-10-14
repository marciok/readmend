import { getRun } from "workflow/api";
import type { ProgressEvent } from "@/workflows/readme-links";

// Progress events as NDJSON. `?startIndex=n` resumes after a dropped connection.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!(await run.exists)) return Response.json({ error: "Run not found" }, { status: 404 });

  const startIndex = Number(new URL(request.url).searchParams.get("startIndex") ?? 0) || 0;
  const encoder = new TextEncoder();
  const ndjson = run.getReadable<ProgressEvent>({ startIndex }).pipeThrough(
    new TransformStream<ProgressEvent, Uint8Array>({
      transform: (event, controller) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)),
    }),
  );

  return new Response(ndjson, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
