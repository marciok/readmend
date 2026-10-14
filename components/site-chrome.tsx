import Link from "next/link";

const REPO_URL = "https://github.com/marciok/readmend";

/** ReadMend's mark: two chain links, one mended. */
export function Logo({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect width="24" height="24" rx="6" className="fill-foreground" />
      <path
        d="M10.5 13.5l3-3M9.2 15.8l-1 1a2.47 2.47 0 01-3.5-3.5l2.8-2.8a2.47 2.47 0 013.5 0M14.8 8.2l1-1a2.47 2.47 0 013.5 3.5l-2.8 2.8a2.47 2.47 0 01-3.5 0"
        className="stroke-background"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <Logo />
          ReadMend
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-hover hover:text-foreground">
            New check
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 font-medium transition-colors hover:bg-hover"
          >
            <GitHubIcon />
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2">
          <Logo className="size-4" /> ReadMend
        </span>
        <span>Runs on Vercel Workflow, Vercel Sandbox and eve.</span>
      </div>
    </footer>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
