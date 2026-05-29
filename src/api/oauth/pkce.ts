import { randomBytes, createHash } from "crypto";

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBase64Url(16);
}
