'use strict';

const { createHash } = require('crypto');
const { existsSync, statSync } = require('fs');
const { readFile, writeFile, unlink, mkdir, rm, readdir } = require('fs/promises');
const path = require('path');

module.exports = ({ strapi }) => ({
  buildKey(hash, params) {
    const relevant = { ...params };
    delete relevant.token;
    const sig = createHash('md5')
      .update(hash + JSON.stringify(relevant))
      .digest('hex');
    return `${hash}-${sig}`;
  },

  cachePath(key, format) {
    const config = strapi.config.get('plugin::image-proxy');
    return path.join(config.cacheDir, `${key}.${format}`);
  },

  async get(key, format) {
    const filePath = this.cachePath(key, format);
    if (!existsSync(filePath)) return null;

    const config = strapi.config.get('plugin::image-proxy');
    const { mtimeMs } = statSync(filePath);
    const ageSeconds = (Date.now() - mtimeMs) / 1000;

    if (ageSeconds > config.ttl) {
      await unlink(filePath).catch(() => {});
      return null;
    }

    return readFile(filePath);
  },

  async set(key, format, buffer) {
    const config = strapi.config.get('plugin::image-proxy');
    await mkdir(config.cacheDir, { recursive: true });
    await writeFile(this.cachePath(key, format), buffer);
  },

  async invalidate(hash) {
    const config = strapi.config.get('plugin::image-proxy');
    if (!existsSync(config.cacheDir)) return;
    const files = await readdir(config.cacheDir);
    await Promise.all(
      files
        .filter(f => f.startsWith(hash))
        .map(f => unlink(path.join(config.cacheDir, f)).catch(() => {}))
    );
  },

  async flush() {
    const config = strapi.config.get('plugin::image-proxy');
    await rm(config.cacheDir, { recursive: true, force: true });
  },

  async stats() {
    const config = strapi.config.get('plugin::image-proxy');
    if (!existsSync(config.cacheDir)) return { files: 0, bytes: 0 };
    const files = await readdir(config.cacheDir);
    let bytes = 0;
    for (const f of files) {
      try {
        const { size } = statSync(path.join(config.cacheDir, f));
        bytes += size;
      } catch {}
    }
    return { files: files.length, bytes };
  }
});
