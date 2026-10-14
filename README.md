# ReadMend

Find broken links in a repository's README and docs. Paste a repository (or a GitHub
`/tree/<branch>/<folder>` link) and get a report of broken links in its README and every docs page
reachable from it.

Live at https://readmend.vercel.app

Built with Next.js, the [Workflow SDK](https://workflow-sdk.dev) and [eve](https://eve.dev). Each
check is a durable workflow run (`workflows/readme-links.ts`):

1. **crawlDocs**: clones the repo in a throwaway Vercel Sandbox, brings back the file list and
   markdown contents, deletes the sandbox, then follows relative links between pages in memory.
2. **categorizeLinks**: splits links into anchor, internal and external; dedupes external URLs.
3. **checkLink** (one step per external URL, in parallel) and **checkInternalLinks** (against the
   clone's file list and heading anchors, no HTTP).
4. **Propose fixes**: broken internal links are grouped into distinct problems and sent to the
   link-doctor eve agent (`agent/`), which clones the repo in its own sandbox (network limited to
   github.com), follows renames in git history and replies with structured fixes. The workflow
   starts the session and polls it with durable sleeps, so no step waits on the agent.
5. **finish**: builds the report, rewrites each fix in the original link's style, and closes the
   progress stream.

The agent is mounted into the Next.js app with `withEve()` and deploys as part of the same Vercel
project. Its route only accepts Vercel OIDC (this deployment) or local dev, so the public site can't
call it directly.

## Develop

Requires Node.js 24.

```bash
npm install
npm run dev
```

Locally, pull the project's development OIDC token for the agent's model (AI Gateway) and sandbox:

```bash
npx vercel env pull .env.development.local
```

The crawl's sandbox can also use explicit credentials in `.env.local` (on Vercel it uses the
deployment's OIDC token and needs nothing):

```
SANDBOX_TOKEN=...        # Vercel access token
SANDBOX_TEAM_ID=team_...
SANDBOX_PROJECT_ID=prj_...
```

Inspect runs with `npx workflow web` or `npx workflow inspect runs`.

## API

- `POST /api/runs` `{ "repo": "<url>", "maxPages": 200 }` → `{ "runId" }`
- `GET /api/runs/:id` → status, plus the report once completed (or the error if it failed)
- `GET /api/runs/:id/events?startIndex=0` → progress events as NDJSON
