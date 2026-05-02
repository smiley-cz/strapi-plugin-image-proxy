'use strict';

const { mkdir } = require('fs/promises');

module.exports = async ({ strapi }) => {
  const config = strapi.config.get('plugin::image-proxy');

  await mkdir(config.cacheDir, { recursive: true });

  //+ Warn if UV_THREADPOOL_SIZE may bottleneck Sharp throughput
  const poolSize = parseInt(process.env.UV_THREADPOOL_SIZE, 10) || 4;
  if (poolSize < config.sharpConcurrency) {
    strapi.log.warn(
      `[image-proxy] UV_THREADPOOL_SIZE (${poolSize}) is smaller than sharpConcurrency (${config.sharpConcurrency}). ` +
      `Set UV_THREADPOOL_SIZE=${config.sharpConcurrency} or higher before starting Node.js for best performance.`
    );
  }

  strapi.log.info(
    `[image-proxy] Ready. Cache: ${config.cacheDir} | TTL: ${config.ttl}s | ` +
    `Concurrency: ${config.sharpConcurrency} | Max input: ${config.maxInputPixels / 1_000_000}MP | ` +
    `UV_THREADPOOL_SIZE: ${poolSize}`
  );

  // Auto-invalidate cache when a file is deleted or replaced in Strapi
  strapi.db.lifecycles.subscribe({
    models: ['plugin::upload.file'],

    async afterDelete(event) {
      const { result } = event;
      if (result?.hash) {
        await strapi.plugin('image-proxy').service('cache').invalidate(result.hash);
        strapi.log.debug(`[image-proxy] Cache invalidated for deleted file: ${result.hash}`);
      }
    },

    async afterUpdate(event) {
      const { result } = event;
      if (result?.hash) {
        await strapi.plugin('image-proxy').service('cache').invalidate(result.hash);
      }
    }
  });
};
