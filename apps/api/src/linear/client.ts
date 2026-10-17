import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Linear's GraphQL API, as much of it as the office needs: teams, issues,
 * comments, labels, a project per office, and the webhook that tells us about
 * changes people make in Linear.
 */
export type StateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
export interface LinearState {
  id: string;
  name: string;
  type: StateType;
}
export interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  state: LinearState;
}

export class LinearError extends Error {}

export class LinearClient {
  private readonly key: string;
  private readonly url: string;

  constructor(o: { apiKey: string; url?: string }) {
    this.key = o.apiKey;
    this.url = o.url ?? "https://api.linear.app/graphql";
  }

  async viewer(): Promise<{ id: string; name: string; organization: string }> {
    const r = await this.q<{ viewer: { id: string; name: string }; organization: { name: string } }>(`{ viewer { id name } organization { name } }`);
    return { id: r.viewer.id, name: r.viewer.name, organization: r.organization.name };
  }

  async teams(): Promise<{ id: string; key: string; name: string }[]> {
    return (await this.q<{ teams: { nodes: { id: string; key: string; name: string }[] } }>(`{ teams(first: 100) { nodes { id key name } } }`)).teams.nodes;
  }

  async team(id: string): Promise<{ id: string; key: string; name: string; states: LinearState[]; labels: { id: string; name: string }[] }> {
    const r = await this.q<{ team: { id: string; key: string; name: string; states: { nodes: LinearState[] }; labels: { nodes: { id: string; name: string }[] } } }>(
      `query($id: String!) { team(id: $id) { id key name states(first: 100) { nodes { id name type } } labels(first: 250) { nodes { id name } } } }`,
      { id },
    );
    return { ...r.team, states: r.team.states.nodes, labels: r.team.labels.nodes };
  }

  async projects(teamId: string): Promise<{ id: string; name: string; url: string }[]> {
    const r = await this.q<{ team: { projects: { nodes: { id: string; name: string; url: string }[] } } }>(
      `query($id: String!) { team(id: $id) { projects(first: 100) { nodes { id name url } } } }`,
      { id: teamId },
    );
    return r.team.projects.nodes;
  }

  async createLabel(teamId: string, name: string, color: string): Promise<string> {
    const r = await this.q<{ issueLabelCreate: { issueLabel: { id: string } } }>(
      `mutation($i: IssueLabelCreateInput!) { issueLabelCreate(input: $i) { issueLabel { id } } }`,
      { i: { teamId, name, color } },
    );
    return r.issueLabelCreate.issueLabel.id;
  }

  async createProject(teamId: string, name: string): Promise<{ id: string; url: string }> {
    const r = await this.q<{ projectCreate: { project: { id: string; url: string } } }>(`mutation($i: ProjectCreateInput!) { projectCreate(input: $i) { project { id url } } }`, {
      i: { name, teamIds: [teamId], description: "Work from an AgentFloor office. Each issue mirrors an office task." },
    });
    return r.projectCreate.project;
  }

  async createIssue(i: { teamId: string; title: string; description?: string; stateId?: string; labelIds?: string[]; projectId?: string | null }): Promise<LinearIssue> {
    const r = await this.q<{ issueCreate: { issue: LinearIssue } }>(
      `mutation($i: IssueCreateInput!) { issueCreate(input: $i) { issue { id identifier url title state { id name type } } } }`,
      { i: { ...i, projectId: i.projectId ?? undefined } },
    );
    return r.issueCreate.issue;
  }

  async updateIssue(id: string, i: { title?: string; description?: string; stateId?: string; labelIds?: string[] }): Promise<void> {
    await this.q(`mutation($id: String!, $i: IssueUpdateInput!) { issueUpdate(id: $id, input: $i) { success } }`, { id, i });
  }

  async issue(idOrIdentifier: string): Promise<LinearIssue & { teamId: string }> {
    const r = await this.q<{ issue: LinearIssue & { team: { id: string } } }>(
      `query($id: String!) { issue(id: $id) { id identifier url title state { id name type } team { id } } }`,
      { id: idOrIdentifier },
    );
    return { ...r.issue, teamId: r.issue.team.id };
  }

  async comment(issueId: string, body: string): Promise<void> {
    await this.q(`mutation($i: CommentCreateInput!) { commentCreate(input: $i) { success } }`, { i: { issueId, body } });
  }

  async attachLink(issueId: string, url: string, title: string): Promise<void> {
    await this.q(`mutation($id: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $id, url: $url, title: $title) { success } }`, { id: issueId, url, title });
  }

  async createWebhook(i: { url: string; teamId: string; secret: string; label: string }): Promise<string> {
    const r = await this.q<{ webhookCreate: { webhook: { id: string } } }>(`mutation($i: WebhookCreateInput!) { webhookCreate(input: $i) { webhook { id } } }`, {
      i: { url: i.url, teamId: i.teamId, secret: i.secret, label: i.label, resourceTypes: ["Issue", "Comment"] },
    });
    return r.webhookCreate.webhook.id;
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.q(`mutation($id: String!) { webhookDelete(id: $id) { success } }`, { id });
  }

  private async q<T = unknown>(query: string, variables?: object): Promise<T> {
    const res = await fetch(this.url, { method: "POST", headers: { authorization: this.key, "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
    if (!res.ok || body.errors?.length) throw new LinearError(`Linear: ${body.errors?.map((e) => e.message).join("; ") || res.statusText}`);
    return body.data as T;
  }
}

/** Linear signs webhook bodies with HMAC-SHA256 (hex) in the linear-signature header. */
export function verifyLinearSignature(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}
