import { AuthManager } from "./auth";

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
      throw new Error(
        `Buildkite API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
  }
}
