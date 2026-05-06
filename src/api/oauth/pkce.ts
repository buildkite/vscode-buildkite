import { randomBytes, createHash } from "crypto";

/**
 * Generates a base64url-encoded, cryptographically random value suitable
 * as a PKCE `code_verifier` or OAuth `state` parameter
 */
function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** Generates a PKCE code verifier (43-character base64url string) */
export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

/**
 * Derives the PKCE `code_challenge` from a verifier using the `S256` method
 */
export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Generates a 128-bit base64url random `state` value for CSRF protection */
export function generateState(): string {
  return randomBase64Url(16);
}
