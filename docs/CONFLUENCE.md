# Confluence brief

Stage 1 freezes a Confluence page into files so later roles do not browse the wiki and do not depend on a live login.

## Point at a page

1. Copy the page URL or numeric id.
2. Fetch it into the run, or paste an export by hand.

Offline (recorded fixture, no token):

```bash
npx tsx src/cli.ts confluence fetch --page 1042 --out runs/<feature-id>/00-source --mock
```

Live Confluence Cloud (`GET /wiki/rest/api/content/{id}?expand=body.storage`):

```bash
npx tsx src/cli.ts confluence fetch --page 1042 --out runs/<feature-id>/00-source
```

Auth is HTTP Basic, `CONFLUENCE_EMAIL`:`CONFLUENCE_API_TOKEN`. The client turns storage HTML into markdown and writes `00-source/page.md`. `--out` must be a relative path under `runs/` (for example `runs/<feature-id>/00-source`). Absolute paths and `..` are rejected. A page URL such as `https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Title` is accepted. `CONFLUENCE_BASE_URL` must be `https`. The host must be `*.atlassian.net` or the exact configured host. Redirects off that allowlist, and link-local or metadata hosts, are refused. The token is never placed in the URL.

Without credentials and without `--mock` / `PIPELINE_MOCK_ATLASSIAN=1`, the command fails and names the missing variables.

3. Record the URL and page id in `runs/<feature-id>/manifest.yaml` and in `01-brief/brief.meta.yaml` after the brief exists.

```yaml
# manifest.yaml (source section)
source:
  kind: confluence
  url: https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain
  pageId: "1042"
```

Live calls read these variables from the environment or an untracked `.env` (see `.env.example`):

- `CONFLUENCE_BASE_URL`
- `CONFLUENCE_EMAIL`
- `CONFLUENCE_API_TOKEN`
- `CONFLUENCE_PAGE_ID`

`integrations/confluence.ts` implements `getPage`. Tests call it with `--mock` or an injected `fetch`. Live calls run only when you pass real credentials.

## What the writer produces

`runs/<feature-id>/01-brief/brief.md` follows [`templates/confluence-brief.md`](../templates/confluence-brief.md). Required sections:

| Section | Contents |
| --- | --- |
| Goals | Outcomes the page commits to, in the page's words where possible |
| Users | Who acts, and who must not |
| Constraints | Stack, auth, latency, data, and operational limits stated or clearly implied |
| Out of scope | Work the page excludes, plus anything the writer is tempted to add |
| Open questions | Decisions the page does not make. Empty only when nothing material is missing |

`01-brief/brief.meta.yaml`:

```yaml
source:
  url: https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain
  pageId: "1042"
  export: 00-source/page.md
openQuestions: []
capturedAt: "2026-09-22"
```

`openQuestions` is a list of strings. A non-empty list makes `pipeline status` stop on the `brief-questions` human gate. Clear the list only after a human answers, and keep the answer in the brief text.

## Rules for the brief

- The brief is a compression of the page, not a design.
- Numbers, role names, and exclusions are copied, not improved.
- If the page contradicts itself, both statements go under open questions and the writer stops.
- Later stages may not "remember" a sentence that was left out of the brief or the page export.
