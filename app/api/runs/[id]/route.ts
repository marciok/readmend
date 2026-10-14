import { getRun } from "workflow/api";
import type { Report } from "@/lib/report";

export interface RunStatusResponse {
  runId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
  report: Report | null;
  error: string | null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun<Report>(id);
  if (!(await run.exists)) return Response.json({ error: "Run not found" }, { status: 404 });

  const [status, createdAt, completedAt] = await Promise.all([run.status, run.createdAt, run.completedAt]);

  // returnValue waits for completion, so only read it once the run has finished
  let report: Report | null = null;
  let error: string | null = null;
  if (status === "completed") report = await run.returnValue;
  if (status === "failed") error = await run.returnValue.then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)));

  const body: RunStatusResponse = {
    runId: id,
    status,
    createdAt: createdAt.toISOString(),
    completedAt: completedAt?.toISOString() ?? null,
    report,
    error,
  };
  return Response.json(body);
}
