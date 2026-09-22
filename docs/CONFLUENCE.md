# Confluence brief

Stage 1 freezes a Confluence page into files so later roles do not browse the wiki and do not depend on a live login.

## Point at a page

1. Copy the page URL.
2. Export or paste the page body into `runs/<feature-id>/00-source/page.md`. Include the title and a link at the top. A live fetch is not required for v1.
3. Record the URL and page id in `runs/<feature-id>/manifest.yaml` and in `01-brief/brief.meta.yaml` after the brief exists.

```yaml
# manifest.yaml (source section)
source:
  kind: confluence
  url: https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain
  pageId: "1042"
```

Environment placeholders, unused by the stub, are in `.env.example`:

- `CONFLUENCE_BASE_URL`
- `CONFLUENCE_EMAIL`
- `CONFLUENCE_API_TOKEN`
- `CONFLUENCE_PAGE_ID`

`integrations/confluence.ts` throws until a team chooses an HTTP client and a token store. Do not half-implement it in a feature branch.

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
