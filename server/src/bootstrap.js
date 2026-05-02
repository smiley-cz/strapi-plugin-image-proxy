'use strict';

const { mkdir } = require('fs/promises');

module.exports = async ({ strapi }) => {
  const config = strapi.config.get('plugin::image-proxy');

  await mkdir(config.cacheDir, { recursive: true });

  strapi.log.info(
    `[image-proxy] Ready. Cache: ${config.cacheDir} | TTL: ${config.ttl}s | ` +
    `Concurrency: ${config.sharpConcurrency} | Max input: ${config.maxInputPixels / 1_000_000}MP`
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
