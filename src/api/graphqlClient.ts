import { AuthManager, throwIfUnauthorized } from "./auth";
import * as vscode from "vscode";
import { DEFAULT_GRAPHQL_URL, resolveConfiguredUrl } from "./oauth/constants";
import { redactIfCredentialShaped } from "../log";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

export class BuildkiteGraphQLClient {
  constructor(private readonly authManager: AuthManager) {}

  private get endpoint(): string {
    return resolveConfiguredUrl(
      vscode.workspace.getConfiguration("buildkite"),
      "graphqlUrl",
      DEFAULT_GRAPHQL_URL,
    );
  }

  async query<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    // see BuildkiteClient.fetch, same reason
    const session = await this.authManager.resolveSession();
    if (!session) {
      throw new Error("Authentication required");
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      await throwIfUnauthorized(response, session);
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
      throw new Error(`GraphQL error: ${redactIfCredentialShaped(errorMessage)}`);
    }

    if (!result.data) {
      throw new Error("GraphQL response missing data");
    }

    return result.data;
  }
}
