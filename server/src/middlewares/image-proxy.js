'use strict';

const path = require('path');
const {
  VALID_PARAMS,
  VALID_INPUT_FORMATS,
  VALID_OUTPUT_FORMATS,
  MIME_MAP,
} = require('../constants');
const { resolveSource } = require('../utils/source-loader');

function hasValidParams(query) {
  for (const k of Object.keys(query)) if (VALID_PARAMS.has(k)) return true;
  return false;
}

function sanitize(str) {
  return path.basename(str).replace(/[^a-zA-Z0-9_\-]/g, '');
}

module.exports = ({ strapi }) => ({
  async process(ctx, next) {
    const config = strapi.config.get('plugin::image-proxy');
    const reqPath = ctx.path;
    const query = ctx.query;

    if (!reqPath.startsWith(config.urlPrefix)) return next();

    const filename = path.basename(reqPath);
    const extMatch = filename.match(/\.([^.]+)$/);
    if (!extMatch) return next();

    const ext = extMatch[1].toLowerCase();
    if (!VALID_INPUT_FORMATS.has(ext)) return next();
    if (!hasValidParams(query)) return next();

    const requestedFormat = query.format || query.f;
    if (requestedFormat && !VALID_OUTPUT_FORMATS.has(requestedFormat)) return next();

    //+ Reject invalid or out-of-range dimensions early (before touching Sharp)
    if (query.w != null) {
      const w = Number(query.w);
      if (!Number.isFinite(w) || w < 1 || w > config.maxOutputWidth) {
        ctx.status = 400;
        ctx.body = { error: `w must be between 1 and ${config.maxOutputWidth}` };
        return;
      }
    }
    if (query.h != null) {
      const h = Number(query.h);
      if (!Number.isFinite(h) || h < 1 || h > config.maxOutputHeight) {
        ctx.status = 400;
        ctx.body = { error: `h must be between 1 and ${config.maxOutputHeight}` };
        return;
      }
    }

    const cacheService = strapi.plugin('image-proxy').service('cache');
    const sharpService = strapi.plugin('image-proxy').service('sharp');
    const fileLookup = strapi.plugin('image-proxy').service('fileLookup');

    const outputFormat = requestedFormat || ext;
    const hash = sanitize(filename.replace(`.${ext}`, ''));
    const cacheKey = cacheService.buildKey(hash, query);

    //+ ETag / conditional response
    const etag = `"${cacheKey}"`;
    if (ctx.get('If-None-Match') === etag) {
      ctx.status = 304;
      return;
    }

    // Cache hit
    const cached = await cacheService.get(cacheKey, outputFormat);
    if (cached) {
      ctx.set('Content-Type', MIME_MAP[outputFormat] || 'image/webp');
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.set('ETag', etag);
      ctx.body = cached;
      return;
    }

    try {
      const targetW = query.w ? Number(query.w) : null;
      const targetH = query.h ? Number(query.h) : null;

      /*
       * Resolve which URL/path to feed Sharp. Order of preference:
       *   1. Smallest Strapi-generated format that still covers target size
       *   2. The original file.url
       *   3. Local fallback path: <publicDir><urlPrefix><hash>.<ext>
       *
       * The lookup is cached in-memory for ~30 s (configurable) so a
       * responsive <img srcset> doesn't hammer the DB on cold cache.
       */
      const file = await fileLookup.findByHash(hash);

      let sourceUrl = null;
      if ((targetW || targetH) && file?.formats) {
        const better = sharpService.pickBestSource(file.formats, targetW, targetH);
        if (better?.url) sourceUrl = better.url;
      }
      if (!sourceUrl) sourceUrl = file?.url ?? `${config.urlPrefix}${hash}.${ext}`;

      const source = await resolveSource(sourceUrl, strapi);
      if (!source) {
        // Asset not on local disk and no remote URL — let Strapi's static
        // handler produce its own 404.
        return next();
      }

      const processed = await sharpService.process(source, query);
      await cacheService.set(cacheKey, outputFormat, processed);

      ctx.set('Content-Type', MIME_MAP[outputFormat] || 'image/webp');
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.set('ETag', etag);
      ctx.body = processed;
    } catch (err) {
      strapi.log.warn(
        `[image-proxy] Processing failed for ${filename}: ${err.message}`,
        {
          error: err.message,
          stack: err.stack,
          path: reqPath,
          query,
          outputFormat,
        }
      );
      return next(); // always fall through — never break image delivery
    }
  },
});
