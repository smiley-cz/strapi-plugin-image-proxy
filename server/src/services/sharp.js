'use strict';

const sharp = require('sharp');
const path = require('path');

module.exports = ({ strapi }) => {
  const config = strapi.config.get('plugin::image-proxy');
  sharp.concurrency(config.sharpConcurrency ?? 2);

  return {
    validateDimensions(w, h) {
      const { maxOutputWidth, maxOutputHeight } = strapi.config.get('plugin::image-proxy');
      if (w && w > maxOutputWidth) {
        throw new Error(`Requested width ${w} exceeds maximum ${maxOutputWidth}`);
      }
      if (h && h > maxOutputHeight) {
        throw new Error(`Requested height ${h} exceeds maximum ${maxOutputHeight}`);
      }
    },

    pickBestSource(formats, targetWidth, targetHeight) {
      if (!formats) return null;
      const target = Math.max(targetWidth || 0, targetHeight || 0);
      if (target === 0) return null;
      const candidates = Object.values(formats)
        .filter(f => f.width >= target)
        .sort((a, b) => a.width - b.width);
      return candidates[0] ?? null;
    },

    async checkPixelLimit(sourcePath) {
      const { maxInputPixels } = strapi.config.get('plugin::image-proxy');
      const meta = await sharp(sourcePath, { limitInputPixels: false }).metadata();
      const pixels = (meta.width || 0) * (meta.height || 0);
      if (pixels > maxInputPixels) {
        throw new Error(
          `Image is ${pixels}px (${meta.width}x${meta.height}), exceeds limit of ${maxInputPixels}px. ` +
          `Use a Strapi-generated format as source instead.`
        );
      }
      return meta;
    },

    async process(sourcePath, params) {
      const config = strapi.config.get('plugin::image-proxy');

      const w = params.w ? Number(params.w) : null;
      const h = params.h ? Number(params.h) : null;

      this.validateDimensions(w, h);

      // Path-based input — Sharp/libvips streams the file with shrink-on-load.
      // sequentialRead avoids loading the full image into libvips cache.
      let pipeline = sharp(sourcePath, {
        limitInputPixels: config.maxInputPixels,
        sequentialRead: true,
      });

      // Resize + focal point
      if (w || h) {
        const fpx = params.fpx ? Number(params.fpx) : 0.5;
        const fpy = params.fpy ? Number(params.fpy) : 0.5;
        pipeline = pipeline.resize(w, h, {
          fit: params.fit || 'cover',
          position: `${fpx * 100}% ${fpy * 100}%`,
          withoutEnlargement: params.withoutEnlargement === 'true',
        });
      }

      // Color & tone
      if (params.grayscale === 'true')  pipeline = pipeline.grayscale();
      if (params.negate === 'true')     pipeline = pipeline.negate();
      if (params.normalize === 'true')  pipeline = pipeline.normalize();
      if (params.tint)                  pipeline = pipeline.tint(params.tint);
      if (params.gamma)                 pipeline = pipeline.gamma(Number(params.gamma));

      // Blur & sharpen
      if (params.blur) {
        const sigma = Math.min(Math.max(Number(params.blur), 0.3), 1000);
        pipeline = pipeline.blur(sigma);
      }
      if (params.sharpen === 'true')    pipeline = pipeline.sharpen();
      if (params.median)                pipeline = pipeline.median(Number(params.median));

      // Orientation
      if (params.flip === 'true')       pipeline = pipeline.flip();
      if (params.flop === 'true')       pipeline = pipeline.flop();
      if (params.rotate)                pipeline = pipeline.rotate(Number(params.rotate));

      // Format (always last)
      const format = params.format || config.defaultFormat;
      const quality = params.q ? Number(params.q) : config.defaultQuality;
      const formatOptions = { quality };

      if (format === 'webp') {
        formatOptions.effort = params.effort ? Number(params.effort) : 4;
        if (params.lossless === 'true') formatOptions.lossless = true;
      }
      if (format === 'avif') {
        formatOptions.effort = params.effort ? Number(params.effort) : 4;
      }
      if (format === 'png') {
        delete formatOptions.quality;
        formatOptions.compressionLevel = params.compressionLevel
          ? Number(params.compressionLevel) : 6;
      }

      pipeline = pipeline.toFormat(format, formatOptions);

      return pipeline.toBuffer();
    }
  };
};
