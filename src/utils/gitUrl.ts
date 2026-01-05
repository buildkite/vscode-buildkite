/**
 * Utilities for normalizing and comparing Git repository URLs.
 */

export interface NormalizedGitUrl {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Normalizes a Git URL to extract host, owner, and repo components.
 * Handles various Git URL formats:
 * - HTTPS: https://github.com/owner/repo.git
 * - SSH shorthand: git@github.com:owner/repo.git
 * - SSH protocol: ssh://git@github.com/owner/repo.git
 *
 * @param url - The Git URL to normalize
 * @returns Normalized URL components, or null if URL cannot be parsed
 */
export function normalizeGitUrl(url: string): NormalizedGitUrl | null {
  if (!url) {
    return null;
  }

  // Remove trailing slashes and .git suffix
  const cleanUrl = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");

  // HTTPS: https://github.com/owner/repo or http://github.com/owner/repo
  const httpsMatch = cleanUrl.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/\s]+)$/i,
  );
  if (httpsMatch) {
    return {
      host: httpsMatch[1].toLowerCase(),
      owner: httpsMatch[2],
      repo: httpsMatch[3],
    };
  }

  // SSH shorthand: git@github.com:owner/repo
  const sshShortMatch = cleanUrl.match(/^git@([^:]+):([^/]+)\/([^/\s]+)$/i);
  if (sshShortMatch) {
    return {
      host: sshShortMatch[1].toLowerCase(),
      owner: sshShortMatch[2],
      repo: sshShortMatch[3],
    };
  }

  // SSH protocol: ssh://git@github.com/owner/repo
  const sshProtoMatch = cleanUrl.match(
    /^ssh:\/\/[^@]+@([^/]+)\/([^/]+)\/([^/\s]+)$/i,
  );
  if (sshProtoMatch) {
    return {
      host: sshProtoMatch[1].toLowerCase(),
      owner: sshProtoMatch[2],
      repo: sshProtoMatch[3],
    };
  }

  // SSH protocol without user: ssh://github.com/owner/repo
  const sshProtoNoUserMatch = cleanUrl.match(
    /^ssh:\/\/([^/]+)\/([^/]+)\/([^/\s]+)$/i,
  );
  if (sshProtoNoUserMatch) {
    return {
      host: sshProtoNoUserMatch[1].toLowerCase(),
      owner: sshProtoNoUserMatch[2],
      repo: sshProtoNoUserMatch[3],
    };
  }

  return null;
}

/**
 * Compares two Git URLs to determine if they point to the same repository.
 *
 * @param url1 - First Git URL
 * @param url2 - Second Git URL
 * @returns true if both URLs point to the same repository
 */
export function gitUrlsMatch(url1: string, url2: string): boolean {
  const normalized1 = normalizeGitUrl(url1);
  const normalized2 = normalizeGitUrl(url2);

  if (!normalized1 || !normalized2) {
    return false;
  }

  return (
    normalized1.host === normalized2.host &&
    normalized1.owner.toLowerCase() === normalized2.owner.toLowerCase() &&
    normalized1.repo.toLowerCase() === normalized2.repo.toLowerCase()
  );
}
