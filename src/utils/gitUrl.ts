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
 * `owner` captures everything up to the final path segment, so nested
 * namespaces (e.g. GitLab subgroups `group/subgroup/repo`) parse with
 * `owner = "group/subgroup"`.
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
    /^https?:\/\/([^/]+)\/(.+)\/([^/\s]+)$/i,
  );
  if (httpsMatch) {
    return {
      host: httpsMatch[1].toLowerCase(),
      owner: httpsMatch[2],
      repo: httpsMatch[3],
    };
  }

  // SSH shorthand: git@github.com:owner/repo
  const sshShortMatch = cleanUrl.match(/^git@([^:]+):(.+)\/([^/\s]+)$/i);
  if (sshShortMatch) {
    return {
      host: sshShortMatch[1].toLowerCase(),
      owner: sshShortMatch[2],
      repo: sshShortMatch[3],
    };
  }

  // SSH protocol: ssh://git@github.com/owner/repo
  const sshProtoMatch = cleanUrl.match(
    /^ssh:\/\/[^@]+@([^/]+)\/(.+)\/([^/\s]+)$/i,
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
    /^ssh:\/\/([^/]+)\/(.+)\/([^/\s]+)$/i,
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

// Lowercased, trailing-slash- and .git-stripped form, for comparing URLs we
// can't structurally parse.
function canonicalRawUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();
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

  // Either side unparseable: fall back to a canonical raw comparison so a
  // substring match like `repo` vs `repo-staging` is still rejected.
  if (!normalized1 || !normalized2) {
    return canonicalRawUrl(url1) === canonicalRawUrl(url2);
  }

  return (
    normalized1.host === normalized2.host &&
    normalized1.owner.toLowerCase() === normalized2.owner.toLowerCase() &&
    normalized1.repo.toLowerCase() === normalized2.repo.toLowerCase()
  );
}

/**
 * Builds the value for the Buildkite REST `repository=` filter, a
 * case-insensitive substring match. Narrows to `owner/repo` when the URL is
 * parseable so a single query matches any URL format the pipeline could be
 * configured with (SSH/HTTPS, with or without .git); falls back to the raw URL
 * otherwise.
 *
 * @param url - The Git URL to build a filter for
 * @returns The substring to pass as the `repository` query parameter
 */
export function repositorySearchFilter(url: string): string {
  const normalized = normalizeGitUrl(url);
  return normalized ? `${normalized.owner}/${normalized.repo}` : url;
}

/**
 * A stable identity for a repository, for use as a cache key. URLs that
 * {@link gitUrlsMatch} treats as equal map to the same key (so a repo's SSH and
 * HTTPS remotes share one cache entry), but the same owner/repo on a different
 * host stays distinct.
 *
 * @param url - The Git URL to build a cache key for
 * @returns A canonical host/owner/repo identity, or the raw-canonical URL
 */
export function repositoryCacheKey(url: string): string {
  const normalized = normalizeGitUrl(url);
  if (!normalized) {
    return canonicalRawUrl(url);
  }
  return `${normalized.host}/${normalized.owner.toLowerCase()}/${normalized.repo.toLowerCase()}`;
}
