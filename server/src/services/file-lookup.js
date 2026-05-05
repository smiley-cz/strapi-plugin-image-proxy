'use strict';

/*
 * Short-lived in-memory cache for plugin::upload.file lookups.
 *
 * The middleware needs the file's `formats` (to pick a smaller source) and
 * `url` (to fetch from local disk or a remote provider) on every cache miss.
 * Without caching, a responsive <img srcset="..."> generates one DB query per
 * variant on cold cache, which is wasteful and amplifies traffic spikes.
 *
 * Lifecycle hooks in bootstrap.js call invalidate() on file update/delete so
 * stale entries are dropped immediately. The TTL is a safety net.
 *
 * Map iteration order is insertion order, so deleting the first key gives us
 * true LRU eviction when entries are re-inserted on access.
 */
module.exports = ({ strapi }) => {
  const map = new Map();
  let ttlMs = 30_000;
  let max = 1000;

  return {
    configure({ ttl, maxEntries } = {}) {
      if (typeof ttl === 'number' && ttl >= 0) ttlMs = ttl * 1000;
      if (Number.isInteger(maxEntries) && maxEntries >= 1) max = maxEntries;
    },

    async findByHash(hash) {
      const now = Date.now();
      const entry = map.get(hash);
      if (entry && now < entry.expires) {
        map.delete(hash);
        map.set(hash, entry);
        return entry.value;
      }
      if (entry) map.delete(hash);

      const file = await strapi.db.query('plugin::upload.file').findOne({
        where: { hash },
        select: ['formats', 'url', 'ext', 'provider'],
      });

      const value = file ?? null;

      if (ttlMs > 0) {
        if (map.size >= max) {
          const oldest = map.keys().next().value;
          map.delete(oldest);
        }
        map.set(hash, { value, expires: now + ttlMs });
      }
      return value;
    },

    invalidate(hash) {
      map.delete(hash);
    },

    clear() {
      map.clear();
    },
  };
};
