/**
 * In-memory cache provider for API responses with TTL support
 * Based on GitLens pattern but simplified for our needs
 */

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export class CacheProvider {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTTL: number;

  private constructor(defaultTTL: number = 60000) {
    this.defaultTTL = defaultTTL; // 60 seconds default
  }

  /**
   * Store data in cache with TTL
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    const actualTTL = ttl ?? this.defaultTTL;
    this.cache.set(key, {
      data,
      cachedAt: now,
      expiresAt: now + actualTTL,
    });
  }

  /**
   * Retrieve data from cache if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  clearMatching(predicate: (key: string) => boolean): void {
    const toDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (predicate(key)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Dispose the cache provider
   */
  dispose(): void {
    this.cache.clear();
  }

  static create(defaultTTL?: number): CacheProvider {
    return new CacheProvider(defaultTTL);
  }
}
