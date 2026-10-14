import { Sandbox } from "@vercel/sandbox";
import path from "node:path/posix";
import {
  anchors,
  classify,
  extract,
  inScope,
  isMarkdown,
  pathExists,
  type Snapshot,
  type Source,
} from "./links";
import type { Page, Target } from "./report";

export class PermanentError extends Error {}

const REPO_DIR = "/tmp/repo";

// Prints every tracked path and the markdown/README contents, base64-encoded between markers, so
// the output survives anything else written to stdout. Symlinks are skipped: their contents
// would come from outside the repo.
const EXPORT_SCRIPT = String.raw`
set -eo pipefail
printf '__FILES__\n'
git ls-files -z | base64 -w0
printf '\n__MARKDOWN__\n'
git ls-files -z -- ':(icase)*.md' ':(icase)*.mdx' ':(icase)*.markdown' ':(icase,glob)**/readme*' |
  while IFS= read -r -d '' f; do
    if [ -f "$f" ] && [ ! -L "$f" ]; then
      printf '%s %s\n' "$(printf '%s' "$f" | base64 -w0)" "$(base64 -w0 < "$f")"
    fi
  done
printf '__END__\n'
`;

/**
 * Clones the repo in a throwaway Vercel Sandbox and brings back only what the crawl needs. The
 * sandbox is deleted before returning, even when cloning or exporting fails.
 */
export async function snapshotRepo(source: Source, onStatus: (msg: string) => Promise<void>): Promise<Snapshot> {
  await onStatus(`Cloning ${source.cloneUrl}${source.ref ? ` (${source.ref})` : ""} in a Vercel Sandbox`);

  const sandbox = await Sandbox.create({
    timeout: 10 * 60_000,
    persistent: false,
    tags: { app: "readmend" },
    ...sandboxCredentials(),
  });

  try {
    // Cloned explicitly (rather than via `source: git`) so the location is known. The URL is passed
    // as an argument after "--", never through a shell.
    const clone = await sandbox.runCommand({
      cmd: "git",
      args: [
        "clone", "--depth", "1", "--single-branch", "--config", "core.symlinks=false",
        ...(source.ref ? ["--branch", source.ref] : []),
        "--", source.cloneUrl, REPO_DIR,
      ],
      env: { GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 5 * 60_000,
    });
    if (clone.exitCode !== 0) {
      const output = await clone.stderr();
      if (/not found|does not exist|could not read Username|Authentication failed/i.test(output)) {
        throw new PermanentError(`could not clone ${source.cloneUrl}: ${output.trim()}`);
      }
      throw new Error(`git clone failed for ${source.cloneUrl}: ${output.trim()}`);
    }

    await onStatus("Exporting the file list and markdown files");
    const result = await sandbox.runCommand({ cmd: "bash", args: ["-c", EXPORT_SCRIPT], cwd: REPO_DIR });
    const output = await result.stdout();
    if (result.exitCode !== 0) {
      throw new Error(`exporting files failed (exit ${result.exitCode}): ${await result.stderr()}`);
    }
    return parseExport(output);
  } finally {
    await sandbox.delete().catch((error) => console.warn(`could not delete sandbox ${sandbox.name}:`, error));
  }
}

// On Vercel the SDK authenticates with the deployment's OIDC token. Elsewhere (local dev) pass a
// token plus team and project IDs explicitly.
function sandboxCredentials() {
  const { SANDBOX_TOKEN: token, SANDBOX_TEAM_ID: teamId, SANDBOX_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

function parseExport(output: string): Snapshot {
  const match = output.match(/__FILES__\n([A-Za-z0-9+/=]*)\n__MARKDOWN__\n([\s\S]*?)__END__/);
  if (!match) throw new Error(`unexpected export output: ${output.slice(0, 300)}`);

  const files = fromBase64(match[1]).split("\0").filter(Boolean);
  const contents = new Map<string, string>();
  for (const line of match[2].split("\n").filter(Boolean)) {
    const [name, content = ""] = line.split(" ");
    contents.set(fromBase64(name), fromBase64(content));
  }

  const dirs = new Set<string>();
  for (const file of files) {
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
      dirs.add(dir === "." ? "" : dir);
      if (dir === ".") break;
    }
  }
  return { files: new Set(files), dirs, contents };
}

const fromBase64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** Breadth-first over markdown pages reachable from the README via relative links. */
export function crawl(snapshot: Snapshot, scope: string, start: string, maxPages: number) {
  const pages: Page[] = [];
  const queue = [start];
  const seen = new Set(queue);

  while (queue.length > 0 && pages.length < maxPages) {
    const pagePath = queue.shift()!;
    const content = snapshot.contents.get(pagePath) ?? "";
    const links = extract(content).map((l) => classify(l, pagePath, scope, snapshot));

    for (const { kind, target } of links) {
      if (
        kind === "internal" && target && isMarkdown(target) && inScope(target, scope) &&
        snapshot.files.has(target) && !seen.has(target)
      ) {
        seen.add(target);
        queue.push(target);
      }
    }
    pages.push({ path: pagePath, anchors: anchors(content), links });
  }

  return { pages, truncated: queue.length > 0 };
}

// Existence (and headings, for markdown files) of every internal link target, including targets
// outside the crawl scope: those are checked but not followed.
export function describeTargets(snapshot: Snapshot, pages: Page[]): Record<string, Target> {
  const targets: Record<string, Target> = {};
  for (const { kind, target } of pages.flatMap((p) => p.links)) {
    if (kind !== "internal" || target === null || target in targets) continue;
    const isFile = snapshot.files.has(target);
    targets[target] = {
      exists: pathExists(snapshot, target),
      dir: snapshot.dirs.has(target),
      anchors: isFile && isMarkdown(target) ? anchors(snapshot.contents.get(target) ?? "") : null,
    };
  }
  return targets;
}
