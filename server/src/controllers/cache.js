'use strict';

module.exports = ({ strapi }) => ({
  async invalidate(ctx) {
    const { hash } = ctx.params;
    if (!hash) return ctx.badRequest('hash is required');
    await strapi.plugin('image-proxy').service('cache').invalidate(hash);
    ctx.body = { ok: true, invalidated: hash };
  },

  async flush(ctx) {
    await strapi.plugin('image-proxy').service('cache').flush();
    ctx.body = { ok: true, message: 'Cache flushed' };
  },

  async stats(ctx) {
    const result = await strapi.plugin('image-proxy').service('cache').stats();
    ctx.body = {
      files: result.files,
      bytes: result.bytes,
      mb: (result.bytes / 1024 / 1024).toFixed(2)
    };
  }
});
