import { AuthManager } from "./auth";
import { Pipeline, Build } from "./types";

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
  async get<T = unknown>(endpoint: string): Promise<T> {
    const token = await AuthManager.requireToken();
    if (!token) {
      throw new Error("Authentication required");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
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

    return response.json() as Promise<T>;
  }

  /**
   * Makes a PUT request to the Buildkite API.
   * @template T - The expected response type
   * @param endpoint - The API endpoint to request
   * @param body - Optional request body
   * @returns The parsed JSON response
   * @throws {Error} If authentication fails or the API returns an error
   */
  async put<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
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

  /**
   * Fetches all pipelines for an organization.
   * @param orgSlug - The organization slug
   * @returns Array of pipelines
   */
  async getPipelines(orgSlug: string): Promise<Pipeline[]> {
    return this.get<Pipeline[]>(
      `/organizations/${orgSlug}/pipelines?per_page=100`,
    );
  }

  /**
   * Fetches recent builds for a pipeline.
   * @param orgSlug - The organization slug
   * @param pipelineSlug - The pipeline slug
   * @param perPage - Number of builds to fetch (default: 10)
   * @returns Array of builds
   */
  async getBuilds(
    orgSlug: string,
    pipelineSlug: string,
    perPage = 10,
  ): Promise<Build[]> {
    return this.get<Build[]>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds?per_page=${perPage}`,
    );
  }

  /**
   * Retries/rebuilds a specific build.
   * @param orgSlug - The organization slug
   * @param pipelineSlug - The pipeline slug
   * @param buildNumber - The build number to retry
   * @returns The newly created build
   */
  async retryBuild(
    orgSlug: string,
    pipelineSlug: string,
    buildNumber: number,
  ): Promise<Build> {
    return this.put<Build>(
      `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/rebuild`,
    );
  }
}
