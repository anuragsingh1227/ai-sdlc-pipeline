/**
 * Confluence adapter stub.
 *
 * TODO: fetch a page with CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL,
 * CONFLUENCE_API_TOKEN, and CONFLUENCE_PAGE_ID, then write
 * runs/<feature-id>/00-source/page.md.
 * TODO: decide token storage with the team before adding an HTTP client.
 * The orchestrator must keep working when this function is never called.
 */

export interface ConfluencePageRef {
  baseUrl: string;
  pageId: string;
}

export async function fetchConfluencePage(
  _ref: ConfluencePageRef,
): Promise<never> {
  throw new Error(
    "Confluence client is not implemented. Export the page to runs/<feature-id>/00-source/page.md. See docs/CONFLUENCE.md.",
  );
}
