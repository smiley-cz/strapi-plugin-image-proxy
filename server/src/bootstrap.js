'use strict';

const { mkdir, readdir, stat, unlink } = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

async function sweepOrphanTmpFiles(cacheDir, maxAgeSeconds, log) {
  if (maxAgeSeconds <= 0) return;
  let files;
  try {
    files = await readdir(cacheDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeSeconds * 1000;
  let removed = 0;
  await Promise.all(
    files
      .filter(f => f.endsWith('.tmp'))
      .map(async f => {
        const fp = path.join(cacheDir, f);
        try {
          const s = await stat(fp);
          if (s.mtimeMs < cutoff) {
            await unlink(fp);
            removed++;
          }
        } catch {}
      })
  );
  if (removed > 0) {
    log.info(`[image-proxy] Swept ${removed} orphan .tmp file(s) from cache`);
  }
}

module.exports = async ({ strapi }) => {
  const config = strapi.config.get('plugin::image-proxy');

  await mkdir(config.cacheDir, { recursive: true });

  /*
   * Apply Sharp's libvips-thread cap once, here, rather than at service-load
   * time. sharp.concurrency() is process-global state — colocating it in
   * bootstrap makes the side effect explicit and easy to find.
   */
  sharp.concurrency(config.sharpConcurrency);

  // Configure file-lookup LRU
  strapi.plugin('image-proxy').service('fileLookup').configure({
    ttl: config.fileLookupTtl,
    maxEntries: config.fileLookupMax,
  });

  // Sweep orphan .tmp files left behind by crashes during atomic cache writes
  await sweepOrphanTmpFiles(config.cacheDir, config.tmpFileMaxAge, strapi.log);

  //+ Warn if UV_THREADPOOL_SIZE may bottleneck Sharp throughput
  const poolSize = parseInt(process.env.UV_THREADPOOL_SIZE, 10) || 4;
  if (poolSize < config.sharpConcurrency * config.maxConcurrentJobs) {
    strapi.log.warn(
      `[image-proxy] UV_THREADPOOL_SIZE (${poolSize}) is smaller than ` +
      `sharpConcurrency × maxConcurrentJobs (${config.sharpConcurrency} × ${config.maxConcurrentJobs} = ` +
      `${config.sharpConcurrency * config.maxConcurrentJobs}). ` +
      `Set UV_THREADPOOL_SIZE accordingly before starting Node.js for best performance.`
    );
  }

  strapi.log.info(
    `[image-proxy] Ready. Cache: ${config.cacheDir} | TTL: ${config.ttl === 0 ? 'never' : config.ttl + 's'} | ` +
    `Concurrency: ${config.sharpConcurrency} threads × ${config.maxConcurrentJobs} jobs | ` +
    `Max input: ${config.maxInputPixels / 1_000_000}MP | URL prefix: ${config.urlPrefix} | ` +
    `UV_THREADPOOL_SIZE: ${poolSize}`
  );

  // Auto-invalidate caches when a file is deleted or replaced in Strapi
  strapi.db.lifecycles.subscribe({
    models: ['plugin::upload.file'],

    async afterDelete(event) {
      const { result } = event;
      if (result?.hash) {
        await strapi.plugin('image-proxy').service('cache').invalidate(result.hash);
        strapi.plugin('image-proxy').service('fileLookup').invalidate(result.hash);
        strapi.log.debug(`[image-proxy] Cache invalidated for deleted file: ${result.hash}`);
      }
    },

    async afterUpdate(event) {
      const { result } = event;
      if (result?.hash) {
        await strapi.plugin('image-proxy').service('cache').invalidate(result.hash);
        strapi.plugin('image-proxy').service('fileLookup').invalidate(result.hash);
      }
    },
  });
};
