'use strict';

const { createHash } = require('crypto');
const { readFile, writeFile, unlink, mkdir, rm, readdir, stat, rename } = require('fs/promises');
const path = require('path');
const { VALID_PARAMS } = require('../constants');

const STATS_CACHE_MS = 60_000;

module.exports = ({ strapi }) => {
  let statsCache = null;
  let statsCacheExpires = 0;

  const invalidateStatsCache = () => {
    statsCache = null;
    statsCacheExpires = 0;
  };

  return {
    //% ============================================
    //% buildKey — only whitelisted params contribute to the key, so unknown
    //%            query strings (utm_*, tracking tokens) cannot pollute cache
    //% ============================================
    buildKey(hash, params) {
      const sorted = {};
      for (const k of Object.keys(params).sort()) {
        if (VALID_PARAMS.has(k)) sorted[k] = params[k];
      }
      const sig = createHash('md5')
        .update(hash + JSON.stringify(sorted))
        .digest('hex');
      return `${hash}-${sig}`;
    },

    //% ============================================
    //% cachePath
    //% ============================================
    cachePath(key, format) {
      const config = strapi.config.get('plugin::image-proxy');
      return path.join(config.cacheDir, `${key}.${format}`);
    },

    //% ============================================
    //% get
    //% ============================================
    async get(key, format) {
      const filePath = this.cachePath(key, format);
      const config = strapi.config.get('plugin::image-proxy');

      let stats;
      try {
        stats = await stat(filePath);
      } catch {
        return null;
      }

      //+ ttl === 0 means "never expire" (matches the documented behaviour)
      if (config.ttl > 0) {
        const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
        if (ageSeconds > config.ttl) {
          await unlink(filePath).catch(() => {});
          return null;
        }
      }

      return readFile(filePath);
    },

    //% ============================================
    //% set (atomic write via tmp + rename)
    //% ============================================
    async set(key, format, buffer) {
      const config = strapi.config.get('plugin::image-proxy');
      await mkdir(config.cacheDir, { recursive: true });
      const target = this.cachePath(key, format);
      const tmp = target + '.tmp';
      try {
        await writeFile(tmp, buffer);
        await rename(tmp, target);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
      invalidateStatsCache();
    },

    //% ============================================
    //% invalidate
    //% ============================================
    async invalidate(hash) {
      const config = strapi.config.get('plugin::image-proxy');
      let files;
      try {
        files = await readdir(config.cacheDir);
      } catch {
        return;
      }
      const prefix = hash + '-';
      await Promise.all(
        files
          .filter(f => f.startsWith(prefix))
          .map(f => unlink(path.join(config.cacheDir, f)).catch(() => {}))
      );
      invalidateStatsCache();
    },

    //% ============================================
    //% flush
    //% ============================================
    async flush() {
      const config = strapi.config.get('plugin::image-proxy');
      await rm(config.cacheDir, { recursive: true, force: true });
      await mkdir(config.cacheDir, { recursive: true });
      invalidateStatsCache();
    },

    //% ============================================
    //% stats — parallel stat() with 60 s memoisation; safe to call from
    //%         dashboards without saturating the disk
    //% ============================================
    async stats() {
      if (statsCache && Date.now() < statsCacheExpires) return statsCache;

      const config = strapi.config.get('plugin::image-proxy');
      let files;
      try {
        files = await readdir(config.cacheDir);
      } catch {
        const empty = { files: 0, bytes: 0 };
        statsCache = empty;
        statsCacheExpires = Date.now() + STATS_CACHE_MS;
        return empty;
      }

      const sizes = await Promise.all(
        files.map(f =>
          stat(path.join(config.cacheDir, f)).then(s => s.size).catch(() => 0)
        )
      );
      const bytes = sizes.reduce((a, b) => a + b, 0);

      statsCache = { files: files.length, bytes };
      statsCacheExpires = Date.now() + STATS_CACHE_MS;
      return statsCache;
    },
  };
};
