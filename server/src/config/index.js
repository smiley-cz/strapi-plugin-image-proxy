'use strict';

const path = require('path');

const VALID_OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);

module.exports = {
  default: {
    cacheDir: path.join(process.cwd(), '.cache', 'image-proxy'),
    ttl: 60 * 60 * 24 * 30,            // 30 days
    defaultFormat: 'webp',
    defaultQuality: 85,                 // 1–100
    maxInputPixels: 100_000_000,        // 100 megapixels (~1 GB peak per image, safe for 4 GB RAM)
    maxOutputWidth: 4000,               // 4000 px
    maxOutputHeight: 4000,              // 4000 px
    sharpConcurrency: 2,                // 2 threads per image
  },
  validator(config) {
    if (typeof config.ttl !== 'number' || config.ttl < 0) {
      throw new Error('image-proxy: ttl must be a positive number');
    }
    if (typeof config.cacheDir !== 'string') {
      throw new Error('image-proxy: cacheDir must be a string path');
    }
    if (typeof config.defaultQuality !== 'number' || config.defaultQuality < 1 || config.defaultQuality > 100) {
      throw new Error('image-proxy: defaultQuality must be a number between 1 and 100');
    }
    if (!VALID_OUTPUT_FORMATS.has(config.defaultFormat)) {
      throw new Error(`image-proxy: defaultFormat must be one of: ${[...VALID_OUTPUT_FORMATS].join(', ')}`);
    }
    if (typeof config.maxInputPixels !== 'number' || !Number.isInteger(config.maxInputPixels) || config.maxInputPixels <= 0) {
      throw new Error('image-proxy: maxInputPixels must be a positive integer');
    }
    if (typeof config.maxOutputWidth !== 'number' || !Number.isInteger(config.maxOutputWidth) || config.maxOutputWidth <= 0) {
      throw new Error('image-proxy: maxOutputWidth must be a positive integer');
    }
    if (typeof config.maxOutputHeight !== 'number' || !Number.isInteger(config.maxOutputHeight) || config.maxOutputHeight <= 0) {
      throw new Error('image-proxy: maxOutputHeight must be a positive integer');
    }
    if (!Number.isInteger(config.sharpConcurrency) || config.sharpConcurrency < 1) {
      throw new Error('image-proxy: sharpConcurrency must be a positive integer');
    }
  }
};
