import * as vscode from "vscode";
import { AuthManager, throwIfUnauthorized } from "./auth";
import { DEFAULT_API_BASE_URL, resolveConfiguredUrl } from "./oauth/constants";
import {
  Pipeline,
  Build,
  BuildState,
  Job,
  Agent,
  JsonValue,
  Artifact,
  PipelinesForRepositoryResponse,
  PipelineWithBuilds,
  CreatePipelineInput,
  UpdatePipelineInput,
} from "./types";
import { BuildkiteGraphQLClient } from "./graphqlClient";

/**
 * Represents a Buildkite organization as returned by;
 * curl -H "Authorization: Bearer $TOKEN" \
 *  -X GET "https://api.buildkite.com/v2/organizations"
 *
 * A token can only be associated with a single org, so we can use this interface safely
 */
export interface Organization {
  id: string;
  graphql_id: string;
  url: string;
  web_url: string;
  name: string;
  slug: string;
  pipelines_url: string;
  agents_url: string;
  emojis_url: string;
  created_at: string;
}

/**
 * Client for interacting with the Buildkite REST API.
 * Handles authentication and API requests.
 */
export class BuildkiteClient {
  private get baseUrl(): string {
    return resolveConfiguredUrl(
      vscode.workspace.getConfiguration("buildkite"),
      "apiBaseUrl",
      DEFAULT_API_BASE_URL,
    );
  }
  private organization: Organization | undefined;
  private readonly graphqlClient: BuildkiteGraphQLClient;

  constructor(private readonly authManager: AuthManager) {
    this.graphqlClient = new BuildkiteGraphQLClient(authManager);
  }

  /**
   * Fetches the organization associated with the API token
   * Results are cached after the first fetch.
   * @returns The organization details
   * @throws {Error} If no organizations are found for the API token
   */
  async getOrganization(): Promise<Organization> {
    if (this.organization) {
      return this.organization;
    }

    const orgs = await this.get<Organization[]>("/organizations");
    if (orgs.length === 0) {
      throw new Error("No organizations found for this API token.");
    }

    this.organization = orgs[0];
    return this.organization;
  }

  /**
   * Drops the cached organization, call when the active credential
   * changes (signout, sign in, or org switch) so a later
   * getOrganization() doesn't return the previous account's org slug
   */
  invalidateOrgCache(): void {
    this.organization = undefined;
  }

  /**
   * Makes a GET request to the Buildkite API.
   * @template T - The expected response type
   * @param endpoint - The API endpoint to request (e.g., "/organizations")
   * @returns The parsed JSON response
   * @throws {Error} If authentication fails or the API returns an error
   */
  async get<T = JsonValue>(endpoint: string): Promise<T> {
    const response = await this.fetch(endpoint);
    return response.json() as Promise<T>;
  }

  private async fetch(endpoint: string, options?: RequestInit): Promise<Response> {
    const session = await this.authManager.requireSession();
    if (!session) {
      throw new Error("Authentication required");
    }

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      await throwIfUnauthorized(response, session);
      if (response.status === 429) {
        throw new Error(
          "Buildkite API rate limit reached. Please wait before refreshing.",
        );
      }

      let errorMessage = `Buildkite API error: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          errorMessage += `\n${errorBody}`;
        }
      } catch {
        // Ignore if we can't read the body
      }

      throw new Error(errorMessage);
    }

    return response;
  }

  /**
   * Fetches all pages of a paginated endpoint.
   * Uses the Link header to find the next page URL.
   */
  private async getAllPages<T>(endpoint: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = endpoint;

    while (nextUrl) {
      const response = await this.fetch(nextUrl);
      const data = (await response.json()) as T[];
      results.push(...data);

      // Parse Link header for next page
      const linkHeader = response.headers.get("Link");
      nextUrl = this.parseNextLink(linkHeader);
    }

    return results;
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) {
      return null;
    }

    // Link header format: <url>; rel="next", <url>; rel="prev", ...
    const links = linkHeader.split(",");
    for (const link of links) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Makes a PUT request to the Buildkite API.
   */
  async put<T = JsonValue>(endpoint: string, body?: JsonValue): Promise<T> {
    const response = await this.fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<T>;
  }

  /**
   * Makes a POST request to the Buildkite API.
   */
  async post<T = JsonValue>(endpoint: string, body?: object): Promise<T> {
    const response = await this.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<T>;
  }

  /**
   * Makes a PATCH request to the Buildkite API.
   */
  async patch<T = JsonValue>(endpoint: string, body?: object): Promise<T> {
    const response = await this.fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<T>;
  }

  async putNoContent(endpoint: string, body?: JsonValue): Promise<void> {
    await this.fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : "{}",
    });
  }
  /**
   * Makes a DELETE request to the Buildkite API.
  **/
  async delete(endpoint: string): Promise<void> {
    await this.fetch(endpoint, { method: "DELETE" });
  }

  async getPipelines(orgSlug: string): Promise<Pipeline[]> {
    return this.getAllPages<Pipeline>(
      `/organizations/${orgSlug}/pipelines?per_page=100`,
    );
  }

  async getBuilds(
    orgSlug: string,
    pipelineSlug: string,
    perPage = 10,
  ): Promise<Build[]> {
    return this.get<Build[]>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds?per_page=${perPage}`,
    );
  }

  async getBuild(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Build> {
    return this.get<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}`,
    );
  }

  async rebuildBuild(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Build> {
    return this.put<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/rebuild`,
    );
  }

  async unblockJob(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
    jobId: string,
    fields?: Record<string, string>,
  ): Promise<Job> {
    const body: JsonValue = fields ? { fields } : {};
    return this.put<Job>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/unblock`,
      body,
    );
  }

  async cancelBuild(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Build> {
    return this.put<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/cancel`,
    );
  }

  async createBuild(
    orgSlug: string,
    pipelineSlug: string,
    body: { commit: string; branch: string }
  ): Promise<Build> {
    return this.post<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds`,
      body
    );
  }

  async getJobs(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Job[]> {
    const build = await this.getBuild(orgSlug, pipelineSlug, buildNumber);
    return build.jobs || [];
  }

  async getArtifacts(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Artifact[]> {
    return this.getAllPages<Artifact>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/artifacts?per_page=100`,
    );
  }

  async getJobArtifacts(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
    jobId: string,
  ): Promise<Artifact[]> {
    return this.getAllPages<Artifact>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/artifacts?per_page=100`,
    );
  }

  async downloadArtifact(downloadUrl: string): Promise<Response> {
    return this.fetch(downloadUrl);
  }

  async retryJob(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
    jobId: string,
  ): Promise<Job> {
    return this.put<Job>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/retry`,
    );
  }

  async getJobLog(job: Job): Promise<string> {
    if (!job.raw_log_url) {
      return "No log available for this job.";
    }

    const response = await this.fetch(job.raw_log_url);
    return response.text();
  }

  /**
   * Fetches pipelines matching a repository URL using GraphQL.
   * Returns pipelines with their latest build in a single query.
   */
  async getPipelinesByRepository(
    orgSlug: string,
    repositoryUrl: string,
  ): Promise<PipelineWithBuilds[]> {
    const query = `
      query GetPipelinesForRepository($orgSlug: ID!, $repoUrl: String!) {
        organization(slug: $orgSlug) {
          pipelines(first: 100, repository: {url: $repoUrl}) {
            edges {
              node {
                slug
                name
                archivedAt
                repository {
                  url
                }
                builds(first: 10) {
                  edges {
                    node {
                      number
                      state
                      branch
                      message
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data =
      await this.graphqlClient.query<PipelinesForRepositoryResponse>(query, {
        orgSlug,
        repoUrl: repositoryUrl,
      });

    return data.organization.pipelines.edges.map(({ node }) => {
      const pipeline: Pipeline = {
        id: "",
        graphql_id: "",
        url: "",
        web_url: "",
        name: node.name,
        slug: node.slug,
        repository: node.repository.url,
        description: null,
        default_branch: "",
        created_at: "",
        archived_at: node.archivedAt ?? null,
        scheduled_builds_count: 0,
        running_builds_count: 0,
        scheduled_jobs_count: 0,
        running_jobs_count: 0,
        waiting_jobs_count: 0,
      };

      const builds: Build[] = node.builds.edges.map(({ node: buildNode }) => ({
        id: "",
        graphql_id: "",
        url: "",
        web_url: buildNode.url,
        number: buildNode.number,
        state: buildNode.state.toLowerCase() as BuildState,
        blocked: false,
        message: buildNode.message || "",
        commit: "",
        branch: buildNode.branch,
        env: {},
        source: "",
        creator: {
          id: "",
          name: "",
          email: "",
          avatar_url: "",
          created_at: "",
        },
        created_at: "",
        scheduled_at: "",
        started_at: null,
        finished_at: null,
        meta_data: {},
        pull_request: null,
        pipeline: {
          id: "",
          graphql_id: "",
          url: "",
          name: node.name,
          slug: node.slug,
        },
      }));

      return { pipeline, builds };
    });
  }

  async getAgents(orgSlug: string): Promise<Agent[]> {
    return this.getAllPages<Agent>(
      `/organizations/${orgSlug}/agents?per_page=100`,
    );
  }

  async stopAgent(orgSlug: string, agentId: string): Promise<void> {
    return this.putNoContent(
      `/organizations/${orgSlug}/agents/${agentId}/stop`,
    );
  }

  async forceStopAgent(orgSlug: string, agentId: string): Promise<void> {
    return this.putNoContent(
      `/organizations/${orgSlug}/agents/${agentId}/stop`,
      { force: true },
    );
  }

  async pauseAgent(orgSlug: string, agentId: string): Promise<void> {
    return this.putNoContent(
      `/organizations/${orgSlug}/agents/${agentId}/pause`,
    );
  }

  async resumeAgent(orgSlug: string, agentId: string): Promise<void> {
    return this.putNoContent(
      `/organizations/${orgSlug}/agents/${agentId}/resume`,
    );
  }

  // Pipeline management
  async createPipeline(
    orgSlug: string,
    input: CreatePipelineInput,
  ): Promise<Pipeline> {
    return this.post<Pipeline>(
      `/organizations/${orgSlug}/pipelines`,
      input,
    );
  }

  async updatePipeline(
    orgSlug: string,
    pipelineSlug: string,
    input: UpdatePipelineInput,
  ): Promise<Pipeline> {
    return this.patch<Pipeline>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}`,
      input,
    );
  }

  async archivePipeline(orgSlug: string, pipelineSlug: string): Promise<void> {
    await this.post(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/archive`);
  }

  async unarchivePipeline(
    orgSlug: string,
    pipelineSlug: string,
  ): Promise<void> {
    await this.post(`/organizations/${orgSlug}/pipelines/${pipelineSlug}/unarchive`);
  }

  async deletePipeline(orgSlug: string, pipelineSlug: string): Promise<void> {
    await this.delete(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}`,
    );
  }
}
