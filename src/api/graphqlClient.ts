import { AuthManager } from "./auth";
import * as vscode from "vscode";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

/**
 * Client for interacting with the Buildkite GraphQL API.
 * Handles authentication and GraphQL requests.
 */
export class BuildkiteGraphQLClient {
  private get endpoint(): string {
    const configured = vscode.workspace
      .getConfiguration("buildkite")
      .get<string>("graphqlUrl");
    return configured && configured.trim()
      ? configured.trim()
      : "https://graphql.buildkite.com/v1";
  }

  /**
   * Executes a GraphQL query.
   * @template T - The expected response data type
   * @param query - The GraphQL query string
   * @param variables - Optional variables for the query
   * @returns The query result data
   * @throws {Error} If authentication fails or the API returns an error
   */
  async query<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const resolved = await AuthManager.requireToken({ resolved: true });
    if (!resolved) {
      throw new Error("Authentication required");
    }
    const { token, source, sessionId } = resolved;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(await AuthManager.handleUnauthorized(source, sessionId));
      }
      if (response.status === 429) {
        throw new Error(
          "Buildkite API rate limit reached. Please wait before refreshing.",
        );
      }
      throw new Error(
        `Buildkite GraphQL API error: ${response.status} ${response.statusText}`,
      );
    }

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const errorMessage = result.errors.map((e) => e.message).join("; ");
      throw new Error(`GraphQL error: ${errorMessage}`);
    }

    if (!result.data) {
      throw new Error("GraphQL response missing data");
    }

    return result.data;
  }
}
