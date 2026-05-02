'use strict';

const { createHash } = require('crypto');
const { readFile, writeFile, unlink, mkdir, rm, readdir, stat, rename } = require('fs/promises');
const path = require('path');

module.exports = ({ strapi }) => ({
  //% ============================================
  //% buildKey
  //% ============================================
  buildKey(hash, params) {
    const relevant = { ...params };
    delete relevant.token;
    //+ Sort keys so ?w=800&h=600 and ?h=600&w=800 produce the same key
    const sorted = Object.keys(relevant).sort().reduce((o, k) => {
      o[k] = relevant[k];
      return o;
    }, {});
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

    const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
    if (ageSeconds > config.ttl) {
      await unlink(filePath).catch(() => {});
      return null;
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
    await writeFile(tmp, buffer);
    await rename(tmp, target);
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
    //+ Use hash + '-' separator to avoid prefix collisions between similar hashes
    const prefix = hash + '-';
    await Promise.all(
      files
        .filter(f => f.startsWith(prefix))
        .map(f => unlink(path.join(config.cacheDir, f)).catch(() => {}))
    );
  },

  //% ============================================
  //% flush
  //% ============================================
  async flush() {
    const config = strapi.config.get('plugin::image-proxy');
    await rm(config.cacheDir, { recursive: true, force: true });
    await mkdir(config.cacheDir, { recursive: true });
  },

  //% ============================================
  //% stats
  //% ============================================
  async stats() {
    const config = strapi.config.get('plugin::image-proxy');
    let files;
    try {
      files = await readdir(config.cacheDir);
    } catch {
      return { files: 0, bytes: 0 };
    }
    let bytes = 0;
    for (const f of files) {
      try {
        const s = await stat(path.join(config.cacheDir, f));
        bytes += s.size;
      } catch {}
    }
    return { files: files.length, bytes };
  }
});
