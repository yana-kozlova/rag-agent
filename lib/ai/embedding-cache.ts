// Simple in-memory cache for embedding queries
// Cache key: userId + normalized query
// Cache TTL: 5 minutes

type CacheEntry = {
  results: any[];
  timestamp: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum number of cached entries

class EmbeddingCache {
  private cache: Map<string, CacheEntry> = new Map();

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private getCacheKey(userId: string, query: string): string {
    const normalized = this.normalizeQuery(query);
    return `${userId}:${normalized}`;
  }

  get(userId: string, query: string): any[] | null {
    const key = this.getCacheKey(userId, query);
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

  set(userId: string, query: string, results: any[]): void {
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

    const key = this.getCacheKey(userId, query);
    this.cache.set(key, {
      results,
      timestamp: Date.now(),
    });
  }
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




