# README link checker

Paste a repository (or a GitHub `/tree/<branch>/<folder>` link) and get a report of broken links in
its README and every docs page reachable from it.

Built with Next.js and the [Workflow SDK](https://workflow-sdk.dev). Each check is a durable workflow
run (`workflows/readme-links.ts`):

1. **crawlDocs**: clones the repo in a throwaway Vercel Sandbox, brings back the file list and
   markdown contents, deletes the sandbox, then follows relative links between pages in memory.
2. **categorizeLinks**: splits links into anchor, internal and external; dedupes external URLs.
3. **checkLink** (one step per external URL, in parallel) and **checkInternalLinks** (against the
   clone's file list and heading anchors, no HTTP).
4. **finish**: builds the report and closes the progress stream.

The UI streams progress from the run and shows the report when it completes.

## Develop

```bash
npm install
npm run dev
```

Locally the sandbox SDK needs credentials in `.env.local` (on Vercel it uses the deployment's OIDC
token and needs nothing):

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
