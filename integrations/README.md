# Integrations

v1 does not call Confluence or Jira. The CLI validates files only.

| File | Status |
| --- | --- |
| `confluence.ts` | Throws. TODO: fetch a page into `00-source/page.md`. |
| `jira.ts` | Throws. TODO: create the epic, then stories, and store keys. |

Environment names are documented in `.env.example`. Do not add SDKs here until a human has a token store and has asked for the client.
