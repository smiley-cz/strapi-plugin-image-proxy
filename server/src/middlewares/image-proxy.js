'use strict';

const path = require('path');
const { existsSync } = require('fs');

const VALID_PARAMS = new Set([
  'w', 'h', 'fit', 'fpx', 'fpy', 'withoutEnlargement',
  'format', 'q', 'lossless', 'effort', 'compressionLevel',
  'grayscale', 'negate', 'normalize', 'tint', 'gamma',
  'blur', 'sharpen', 'median',
  'flip', 'flop', 'rotate',
]);

const VALID_INPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);
const VALID_OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff']);

const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', tiff: 'image/tiff',
};

function hasValidParams(query) {
  return Object.keys(query).some(k => VALID_PARAMS.has(k));
}

function sanitize(str) {
  return path.basename(str).replace(/[^a-zA-Z0-9_\-]/g, '');
}

module.exports = ({ strapi }) => ({
  async process(ctx, next) {
    const reqPath = ctx.path;
    const query = ctx.query;

    if (!reqPath.startsWith('/uploads/')) return next();

    const filename = path.basename(reqPath);
    const extMatch = filename.match(/\.([^.]+)$/);
    if (!extMatch) return next();

    const ext = extMatch[1].toLowerCase();

    if (!VALID_INPUT_FORMATS.has(ext)) return next();
    if (!hasValidParams(query)) return next();
    if (query.format && !VALID_OUTPUT_FORMATS.has(query.format)) return next();

    const cacheService = strapi.plugin('image-proxy').service('cache');
    const sharpService = strapi.plugin('image-proxy').service('sharp');
    const config = strapi.config.get('plugin::image-proxy');

    const outputFormat = query.format || config.defaultFormat;
    const hash = sanitize(filename.replace(`.${ext}`, ''));
    const cacheKey = cacheService.buildKey(hash, query);

    // Cache hit
    const cached = await cacheService.get(cacheKey, outputFormat);
    if (cached) {
      ctx.set('Content-Type', MIME_MAP[outputFormat] || 'image/webp');
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.set('X-Image-Cache', 'HIT');
      ctx.body = cached;
      return;
    }

    const uploadDir = path.join(strapi.dirs.static.public, 'uploads');
    let sourcePath = path.join(uploadDir, `${hash}.${ext}`);

    try {
      // Prefer a Strapi-generated smaller format as source where possible
      const targetW = query.w ? Number(query.w) : null;
      const targetH = query.h ? Number(query.h) : null;

      if (targetW || targetH) {
        const file = await strapi.db.query('plugin::upload.file').findOne({
          where: { hash },
          select: ['formats']
        });

        if (file?.formats) {
          const betterSource = sharpService.pickBestSource(file.formats, targetW, targetH);
          if (betterSource) {
            const candidate = path.join(uploadDir, path.basename(betterSource.url));
            if (existsSync(candidate)) sourcePath = candidate;
          }
        }
      }

      // Safety: check pixel limit on chosen source
      await sharpService.checkPixelLimit(sourcePath);

      const processed = await sharpService.process(sourcePath, query);
      await cacheService.set(cacheKey, outputFormat, processed);

      ctx.set('Content-Type', MIME_MAP[outputFormat] || 'image/webp');
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.set('X-Image-Cache', 'MISS');
      ctx.body = processed;

    } catch (err) {
      strapi.log.warn(`[image-proxy] Processing failed for ${filename}: ${err.message}`);
      return next(); // always fall through — never break image delivery
    }
  }
});
