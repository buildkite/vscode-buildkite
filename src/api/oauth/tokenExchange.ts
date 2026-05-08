import { trimTrailingSlash } from "./constants";
import { redactIfCredentialShaped } from "../../log";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope: string;
  tokenType: string;
}

export class RefreshTokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenInvalidError";
  }
}

export interface ExchangeCodeInput {
  webBaseUrl: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export async function exchangeAuthorizationCode(
  input: ExchangeCodeInput,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });

  return postToken(input.webBaseUrl, body, { classifyAsRefresh: false });
}

export interface RefreshInput {
  webBaseUrl: string;
  clientId: string;
  refreshToken: string;
  scopes: readonly string[];
}

export async function refreshAccessToken(
  input: RefreshInput,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
  // Send the original grant's scopes so the server can't silently narrow
  // the refreshed token below what the stored session claims to hold
  //
  // If the response comes back with a smaller `scope`, grantedScopes()
  // picks it up and the session updates honestly
  if (input.scopes.length > 0) {
    body.set("scope", input.scopes.join(" "));
  }

  return postToken(input.webBaseUrl, body, { classifyAsRefresh: true });
}

interface PostTokenOptions {
  classifyAsRefresh: boolean;
}

async function postToken(
  webBaseUrl: string,
  body: URLSearchParams,
  opts: PostTokenOptions,
): Promise<TokenResponse> {
  const url = `${trimTrailingSlash(webBaseUrl)}/oauth/token`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        // Stop intermediaries from serving a stale 200
        "Cache-Control": "no-store",
      },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error contacting Buildkite: ${message}`);
  }

  const rawBody = await safeReadText(response);
  const parsed = tryParseJson(rawBody);

  if (!response.ok) {
    const errorCode = typeof parsed?.error === "string" ? parsed.error : `http_${response.status}`;
    // Raw non-JSON body could echo our refresh_token, send the size only
    // and redact parsed error_description in case it leaks too
    const errorDescription =
      typeof parsed?.error_description === "string"
        ? redactIfCredentialShaped(parsed.error_description)
        : rawBody
          ? `non-JSON response body (${rawBody.length} bytes)`
          : "";
    const message = `Token request failed: ${errorCode}${errorDescription ? ` (${errorDescription})` : ""}`;

    // Only invalid_grant kills the session, invalid_client and
    // unauthorized_client are config typos, throw a regular error for
    // those
    if (opts.classifyAsRefresh && errorCode === "invalid_grant") {
      throw new RefreshTokenInvalidError(message);
    }

    throw new Error(message);
  }

  if (!parsed || typeof parsed.access_token !== "string") {
    throw new Error("Token response did not include an access_token");
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: typeof parsed.refresh_token === "string" ? parsed.refresh_token : undefined,
    expiresIn: typeof parsed.expires_in === "number" ? parsed.expires_in : undefined,
    scope: typeof parsed.scope === "string" ? parsed.scope : "",
    tokenType: typeof parsed.token_type === "string" ? parsed.token_type : "Bearer",
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function tryParseJson(raw: string): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

