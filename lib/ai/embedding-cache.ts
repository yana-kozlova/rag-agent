/**
 * A short-lived memo over search results, keyed by user and query text.
 *
 * Deliberately in-process, and worth being honest about what that buys: on a
 * serverless deployment each instance keeps its own Map, so this is not a cache
 * shared between requests so much as one that spans the several searches a
 * single turn makes and the follow-up questions that land on a warm instance.
 * That is still the case it was written for — the agent asks the same question
 * more than once within a conversation far more often than two conversations
 * ask the same thing five minutes apart. A cross-instance cache would need a
 * store outside the process, which is a dependency decision and not this file's
 * to make.
 *
 * Entries are scoped, because two different things are cached under the same
 * user: raw retrieval results for one query, and the finished answer for one
 * question. Those are different shapes, and a question can be spelled exactly
 * like a query variant.
 */

type CacheEntry = {
  results: any[];
  timestamp: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of cached entries

/** What is being cached under a key. See the note on scoping above. */
export type CacheScope = 'search' | 'answer';

class EmbeddingCache {
  private cache: Map<string, CacheEntry> = new Map();

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** User first, so `clearForUser` can stay a prefix match. */
  private getCacheKey(userId: string, query: string, scope: CacheScope): string {
    return `${userId}:${scope}:${this.normalizeQuery(query)}`;
  }

  get(userId: string, query: string, scope: CacheScope = 'search'): any[] | null {
    const key = this.getCacheKey(userId, query, scope);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if entry is expired
    const now = Date.now();
    if (now - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  set(userId: string, query: string, results: any[], scope: CacheScope = 'search'): void {
    // Limit cache size - remove oldest entries if needed
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const key = this.getCacheKey(userId, query, scope);
    this.cache.set(key, {
      results,
      timestamp: Date.now(),
    });
  }

  /** Drops every scope at once: a new note invalidates answers as well as searches. */
  clearForUser(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance
export const embeddingCache = new EmbeddingCache();
