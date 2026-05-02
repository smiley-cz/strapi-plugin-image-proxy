'use strict';

const path = require('path');
const { access } = require('fs/promises');

const VALID_PARAMS = new Set([
  'w', 'h', 'fit', 'fpx', 'fpy', 'withoutEnlargement',
  'f', 'format', 'q', 'lossless', 'effort', 'compressionLevel',
  'grayscale', 'negate', 'normalize', 'tint', 'gamma',
  'blur', 'sharpen', 'median',
  'flip', 'flop', 'rotate',
]);

const VALID_INPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);
const VALID_OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);

const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', tiff: 'image/tiff', gif: 'image/gif',
};

function hasValidParams(query) {
  return Object.keys(query).some(k => VALID_PARAMS.has(k));
}

function sanitize(str) {
  return path.basename(str).replace(/[^a-zA-Z0-9_\-]/g, '');
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
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

    const requestedFormat = query.format || query.f;
    if (requestedFormat && !VALID_OUTPUT_FORMATS.has(requestedFormat)) return next();

    const config = strapi.config.get('plugin::image-proxy');

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
      ctx.set('X-Image-Cache', 'HIT');
      ctx.body = cached;
      return;
    }

    const uploadDir = path.join(strapi.dirs.static.public, 'uploads');
    let sourcePath = path.join(uploadDir, `${hash}.${ext}`);

    try {
      //+ Prefer a Strapi-generated smaller format as source where possible
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
            if (await fileExists(candidate)) sourcePath = candidate;
          }
        }
      }

      const processed = await sharpService.process(sourcePath, query);
      await cacheService.set(cacheKey, outputFormat, processed);

      ctx.set('Content-Type', MIME_MAP[outputFormat] || 'image/webp');
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      ctx.set('ETag', etag);
      ctx.set('X-Image-Cache', 'MISS');
      ctx.body = processed;

    } catch (err) {
      strapi.log.warn(`[image-proxy] Processing failed for ${filename}: ${err.message}`);
      return next(); // always fall through — never break image delivery
    }
  }
});
