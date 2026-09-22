/**
 * Jira adapter stub.
 *
 * TODO: create the epic first, then stories, using JIRA_BASE_URL,
 * JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_PROJECT_KEY.
 * TODO: write returned keys back into runs/<feature-id>/04-jira/tickets.yaml.
 * Do not call Jira from `pipeline validate` or `pipeline status`.
 */

export interface JiraDraft {
  project: string;
  summary: string;
}

export async function createJiraIssue(_draft: JiraDraft): Promise<never> {
  throw new Error(
    "Jira client is not implemented. Keep ticket drafts in runs/<feature-id>/04-jira/tickets.yaml. See docs/JIRA.md.",
  );
}
