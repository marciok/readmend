import { isIP } from "node:net";
import path from "node:path/posix";

export type LinkType = "inline" | "image" | "reference" | "autolink" | "html" | "bare";
export type LinkKind = "anchor" | "internal" | "external";

export interface RawLink {
  text: string | null;
  url: string;
  type: LinkType;
}

export interface Link extends RawLink {
  kind: LinkKind;
  /** Repo path the link points at (anchors: the page itself). null when it leaves the repo. */
  target: string | null;
  fragment: string | null;
}

/** What crawlDocs needs from a clone: every tracked path, plus markdown/README contents. */
export interface Snapshot {
  files: Set<string>;
  dirs: Set<string>;
  contents: Map<string, string>;
}

export const README_NAMES = ["readme.md", "readme.markdown", "readme.rst", "readme.txt", "readme"];
const MARKDOWN_EXTS = [".md", ".mdx", ".markdown"];

// [text](url) and [text](url "title"); images (![alt](url)) are matched too
const INLINE_LINK = /!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
// [label]: url
const REFERENCE_LINK = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm;
// <https://example.com>
const AUTOLINK = /<(https?:\/\/[^>\s]+)>/g;
// href="..." / src="..." in embedded HTML
const HTML_LINK = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
// bare URLs
const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]+/g;

// ATX ("## Title") and setext ("Title\n-----") headings
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const SETEXT_HEADING = /^([^\n|]*\S[^\n|]*)\n[ \t]*(?:=+|-{2,})[ \t]*$/gm;
// explicit targets: <a name="x">, id="x", and MDX/kramdown "## Title {#x}"
const EXPLICIT_ANCHOR = /(?:\sid|<a\s[^>]*name)\s*=\s*["']([^"']+)["']/gi;
const CUSTOM_HEADING_ID = /\s*\{#([^}]+)\}\s*$/;

// Hosts that only resolve locally or are reserved for docs/examples (RFC 2606, RFC 6761)
const PLACEHOLDER_HOSTS = ["localhost", "host.docker.internal", "example.com", "example.org", "example.net"];
const PLACEHOLDER_TLDS = [
  ".localhost", ".local", ".internal", ".test", ".example", ".invalid",
  ".example.com", ".example.org", ".example.net",
];

// Links and headings inside code samples aren't real. Inline code keeps its text (it's part of
// heading IDs and link labels) unless it looks like link syntax.
export function stripCode(content: string): string {
  return content
    .replace(/^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1[ \t]*$/gm, "")
    .replace(/`([^`\n]+)`/g, (_, code: string) => (/\]\(|:\/\/|[<>]|href|src/.test(code) ? "" : code));
}

export function extract(markdown: string): RawLink[] {
  const content = stripCode(markdown);
  const scan = (re: RegExp) => [...content.matchAll(re)];

  const found: RawLink[] = [
    ...scan(INLINE_LINK).map(([match, text, url]) => ({
      text: squish(text),
      url,
      type: (match.startsWith("!") ? "image" : "inline") as LinkType,
    })),
    ...scan(REFERENCE_LINK).map(([, label, url]) => ({ text: label, url, type: "reference" as const })),
    ...scan(AUTOLINK).map(([, url]) => ({ text: null, url, type: "autolink" as const })),
    ...scan(HTML_LINK).map(([, url]) => ({ text: null, url, type: "html" as const })),
  ];
  const known = new Set(found.map((l) => l.url));

  // Bare URLs not already captured by one of the structured forms above
  const bare = scan(BARE_URL)
    .map(([url]) => url.replace(/\.+$/, ""))
    .filter((url) => !known.has(url))
    .map((url) => ({ text: null, url, type: "bare" as const }));

  return uniqBy([...found, ...bare], (l) => l.url).filter(
    (l) => !placeholderUrl(l.url) && !uncheckableScheme(l.url),
  );
}

// mailto:, tel:, data:, javascript: and the like can't be followed or fetched
function uncheckableScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url);
}

export function placeholderUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  return (
    host === "" ||
    PLACEHOLDER_HOSTS.includes(host) ||
    PLACEHOLDER_TLDS.some((tld) => host.endsWith(tld)) ||
    nonPublicIp(host)
  );
}

function nonPublicIp(host: string): boolean {
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) || host === "0.0.0.0"
    );
  }
  return isIP(host) === 6 && ["::", "::1"].includes(host);
}

// anchor: "#section" on the same page; external: absolute http(s) URL; internal: a path in the
// repo, resolved against the page's folder and narrowed to an existing file when possible.
export function classify(link: RawLink, page: string, scope: string, snapshot: Snapshot): Link {
  if (link.url.startsWith("#")) {
    return { ...link, kind: "anchor", target: page, fragment: decode(link.url.slice(1)) };
  }
  if (/^(https?:)?\/\//i.test(link.url)) {
    return { ...link, kind: "external", target: null, fragment: null };
  }

  const [rawPath, ...rest] = link.url.split("#");
  const filePath = decode(rawPath.split("?")[0]) ?? "";
  const bases = (filePath === "" ? [page] : candidateBases(filePath, page, scope)).filter(
    (b): b is string => b !== null,
  );
  const target = bases.map((b) => existingVariant(snapshot, b)).find(Boolean) ?? bases[0] ?? null;

  return { ...link, kind: "internal", target, fragment: rest.length ? decode(rest.join("#")) : null };
}

// "/x" is the repo root on GitHub but the site root (usually the docs folder) on a docs site, so
// try both. Docs sites also serve guides/index.mdx at /guides (no trailing slash), so its relative
// links resolve from the parent folder there, but from guides/ on GitHub. Try both too.
function candidateBases(filePath: string, page: string, scope: string): (string | null)[] {
  if (filePath.startsWith("/")) {
    const p = filePath.slice(1);
    return uniq([safeRepoPath(p), safeRepoPath(path.join(scope || ".", p))]);
  }
  const dir = path.dirname(page);
  const dirs = indexPage(page) && dir !== "." ? [dir, path.dirname(dir)] : [dir];
  return dirs.map((d) => safeRepoPath(path.join(d, filePath)));
}

function indexPage(page: string): boolean {
  return ["index", "readme"].includes(path.basename(page, path.extname(page)).toLowerCase());
}

/** Normalized repo-relative path, or null when it climbs out of the repo. */
export function safeRepoPath(p: string): string | null {
  const normalized = path.normalize(p).replace(/\/+$/, "");
  if (normalized === "." || normalized === "") return "";
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized.replace(/^\.\//, "");
}

// Docs sites drop extensions ("./guides/auth" -> guides/auth.mdx) and serve folders from their
// index page, so a link counts as existing if any of those files is in the repo.
function existingVariant(snapshot: Snapshot, base: string): string | null {
  const candidates = [
    base,
    ...MARKDOWN_EXTS.map((ext) => base + ext),
    ...["index.md", "index.mdx", "README.md"].map((f) => path.join(base || ".", f)),
  ];
  return candidates.find((f) => snapshot.files.has(f)) ?? (pathExists(snapshot, base) ? base : null);
}

export const pathExists = (s: Snapshot, p: string) => s.files.has(p) || s.dirs.has(p);
export const isMarkdown = (p: string) => MARKDOWN_EXTS.includes(path.extname(p).toLowerCase());
export const inScope = (p: string, scope: string) => scope === "" || p.startsWith(`${scope}/`);

// GitHub-style heading IDs, plus explicit ids/names in the page. Lowercased for matching.
export function anchors(markdown: string): string[] {
  const text = stripCode(markdown);
  const headings = [...text.matchAll(ATX_HEADING), ...text.matchAll(SETEXT_HEADING)].map(([, h]) => {
    const custom = h.match(CUSTOM_HEADING_ID);
    return custom ? custom[1] : slug(h);
  });

  const counts = new Map<string, number>();
  const slugs = headings.map((s) => {
    const n = counts.get(s) ?? 0;
    counts.set(s, n + 1);
    return n === 0 ? s : `${s}-${n}`;
  });
  const explicit = [...text.matchAll(EXPLICIT_ANCHOR)].map(([, id]) => id);

  return uniq([...slugs, ...explicit].map((a) => a.toLowerCase()));
}

export function slug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/** Checked without the fragment; protocol-relative URLs are assumed https. */
export function checkUrl(url: string): string {
  const withoutFragment = url.split("#")[0];
  return withoutFragment.startsWith("//") ? `https:${withoutFragment}` : withoutFragment;
}

/** "/pricing" from a docs folder is most likely a route of the website, not a file in the repo. */
export function siteRoute(url: string, scope: string): boolean {
  return scope !== "" && url.startsWith("/") && url.slice(1).split("/")[0] !== scope.split("/")[0];
}

export interface Source {
  cloneUrl: string;
  ref: string | null;
  dir: string;
}

// Accepts a plain clone URL, or a GitHub folder/file URL such as
// https://github.com/owner/name/tree/main/docs (README is looked up in that folder).
export function parseSource(repo: string): Source {
  const m = repo.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+?)(?:\.git)?\/(tree|blob)\/([^/]+)(?:\/(.*?))?\/?$/);
  if (!m) return { cloneUrl: repo, ref: null, dir: "" };

  const [, cloneUrl, kind, ref, rest = ""] = m;
  const dir = safeRepoPath(kind === "blob" ? path.dirname(rest) : rest);
  if (dir === null) throw new Error(`invalid path in ${repo}`);
  return { cloneUrl, ref, dir };
}

export function findReadme(snapshot: Snapshot, dir: string): string | null {
  const parent = dir === "" ? "." : dir;
  const name = [...snapshot.files]
    .filter((f) => path.dirname(f) === parent && README_NAMES.includes(path.basename(f).toLowerCase()))
    .map((f) => path.basename(f))
    .sort((a, b) => README_NAMES.indexOf(a.toLowerCase()) - README_NAMES.indexOf(b.toLowerCase()))[0];
  if (!name) return null;
  return dir === "" ? name : path.join(dir, name);
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Link labels as a reader sees them: whitespace collapsed, **bold**/__bold__/`code` markers dropped
const squish = (text: string) => text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const uniqBy = <T,>(xs: T[], key: (x: T) => string) => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
};
