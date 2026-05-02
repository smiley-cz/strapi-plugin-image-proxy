'use strict';

const path = require('path');
const sharp = require('sharp');

const VALID_FITS = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

//% ============================================
//% Numeric helpers
//% ============================================

function int(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function float(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

module.exports = ({ strapi }) => {
  const config = strapi.config.get('plugin::image-proxy');
  sharp.concurrency(config.sharpConcurrency ?? 2);

  return {
    //% ============================================
    //% validateDimensions
    //% ============================================
    validateDimensions(w, h) {
      const { maxOutputWidth, maxOutputHeight } = strapi.config.get('plugin::image-proxy');
      if (w && w > maxOutputWidth) {
        throw new Error(`Requested width ${w} exceeds maximum ${maxOutputWidth}`);
      }
      if (h && h > maxOutputHeight) {
        throw new Error(`Requested height ${h} exceeds maximum ${maxOutputHeight}`);
      }
    },

    //% ============================================
    //% pickBestSource
    //% ============================================
    pickBestSource(formats, targetWidth, targetHeight) {
      if (!formats) return null;
      const target = Math.max(targetWidth || 0, targetHeight || 0);
      if (target === 0) return null;
      const candidates = Object.values(formats)
        .filter(f => f.width >= target)
        .sort((a, b) => a.width - b.width);
      return candidates[0] ?? null;
    },

    //% ============================================
    //% process
    //% ============================================
    async process(sourcePath, params) {
      const config = strapi.config.get('plugin::image-proxy');

      const w = int(params.w, 1, config.maxOutputWidth);
      const h = int(params.h, 1, config.maxOutputHeight);

      /*
       * Single Sharp instance: limitInputPixels rejects oversized images,
       * failOn 'error' tolerates slightly corrupt uploads (phone cameras etc.),
       * autoOrient fixes EXIF rotation before any transforms.
       */
      let pipeline = sharp(sourcePath, {
        limitInputPixels: config.maxInputPixels,
        sequentialRead: true,
        failOn: 'error',
        autoOrient: true,
      });

      //+ Resize + focal point
      if (w || h) {
        const fit = VALID_FITS.has(params.fit) ? params.fit : 'cover';
        const fpx = float(params.fpx, 0, 1) ?? 0.5;
        const fpy = float(params.fpy, 0, 1) ?? 0.5;

        const col = fpx <= 0.33 ? 'left' : fpx >= 0.67 ? 'right' : '';
        const row = fpy <= 0.33 ? 'top' : fpy >= 0.67 ? 'bottom' : '';
        const position = col || row ? [col, row].filter(Boolean).join(' ') : 'centre';

        pipeline = pipeline.resize(w, h, {
          fit,
          position,
          withoutEnlargement: params.withoutEnlargement !== 'false',
        });
      }

      //+ Color & tone
      if (params.grayscale === 'true')  pipeline = pipeline.grayscale();
      if (params.negate === 'true')     pipeline = pipeline.negate();
      if (params.normalize === 'true')  pipeline = pipeline.normalize();
      if (params.tint && HEX_COLOR_RE.test(params.tint)) {
        pipeline = pipeline.tint(params.tint);
      }
      if (params.gamma) {
        const g = float(params.gamma, 1.0, 3.0);
        if (g) pipeline = pipeline.gamma(g);
      }

      //+ Blur & sharpen
      if (params.blur) {
        const sigma = float(params.blur, 0.3, 1000);
        if (sigma) pipeline = pipeline.blur(sigma);
      }
      if (params.sharpen === 'true')    pipeline = pipeline.sharpen();
      if (params.median) {
        const m = int(params.median, 3, 99);
        if (m && m % 2 === 1) pipeline = pipeline.median(m);
      }

      //+ Orientation (manual — autoOrient handles EXIF automatically)
      if (params.flip === 'true')       pipeline = pipeline.flip();
      if (params.flop === 'true')       pipeline = pipeline.flop();
      if (params.rotate) {
        const deg = float(params.rotate, -360, 360);
        if (deg !== null) pipeline = pipeline.rotate(deg);
      }

      //+ Strip all metadata (EXIF, GPS, ICC, XMP) from processed output
      pipeline = pipeline.withMetadata(false);

      //+ Format (always last) — preserve source format unless explicitly overridden
      const sourceExt = path.extname(sourcePath).slice(1).toLowerCase();
      const format = params.format || params.f || sourceExt || config.defaultFormat;
      const quality = int(params.q, 1, 100) ?? config.defaultQuality;
      const formatOptions = { quality };

      if (format === 'webp') {
        formatOptions.effort = int(params.effort, 0, 6) ?? 4;
        if (params.lossless === 'true') formatOptions.lossless = true;
      }
      if (format === 'avif') {
        formatOptions.effort = int(params.effort, 0, 6) ?? 4;
      }
      if (format === 'png') {
        delete formatOptions.quality;
        formatOptions.compressionLevel = int(params.compressionLevel, 0, 9) ?? 6;
      }

      pipeline = pipeline.toFormat(format, formatOptions);

      return pipeline.toBuffer();
    }
  };
};
