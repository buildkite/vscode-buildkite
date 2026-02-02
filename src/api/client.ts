import { AuthManager } from "./auth";
import { Pipeline, Build, Job, JsonValue } from "./types";

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
  private baseUrl = "https://api.buildkite.com/v2";
  private organization: Organization | undefined;

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

  private async fetch(endpoint: string): Promise<Response> {
    const token = await AuthManager.requireToken();
    if (!token) {
      throw new Error("Authentication required");
    }

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Invalid API token. Please update your Buildkite API token.",
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Buildkite API rate limit reached. Please wait before refreshing.",
        );
      }
      throw new Error(
        `Buildkite API error: ${response.status} ${response.statusText}`,
      );
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
   * @template T - The expected response type
   * @param endpoint - The API endpoint to request
   * @param body - Optional request body
   * @returns The parsed JSON response
   * @throws {Error} If authentication fails or the API returns an error
   */
  async put<T = JsonValue>(endpoint: string, body?: JsonValue): Promise<T> {
    const token = await AuthManager.requireToken();
    if (!token) {
      throw new Error("Authentication required");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Invalid API token. Please update your Buildkite API token.",
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Buildkite API rate limit reached. Please wait before retrying.",
        );
      }
      throw new Error(
        `Buildkite API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
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

  async getJobs(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Job[]> {
    const build = await this.getBuild(orgSlug, pipelineSlug, buildNumber);
    return build.jobs || [];
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

  async cancelBuild(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Build> {
    return this.put<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/cancel`,
    );
  }

  /**
   * Fetches the raw log content for a specific job.
   * @param job - The job object containing the raw_log_url
   * @returns The raw log content as text
   */
  async getJobLog(job: Job): Promise<string> {
    if (!job.raw_log_url) {
      return "No log available for this job.";
    }

    const response = await this.fetch(job.raw_log_url);
    return response.text();
  }
}
