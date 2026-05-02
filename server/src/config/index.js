'use strict';

module.exports = {
  default: {
    cacheDir: '/var/cache/strapi-image-proxy',
    ttl: 60 * 60 * 24 * 30,
    defaultFormat: 'webp',
    defaultQuality: 85,
    maxInputPixels: 500_000_000,
    maxOutputWidth: 4000,
    maxOutputHeight: 4000,
    sharpConcurrency: 2,
  },
  validator(config) {
    if (typeof config.ttl !== 'number' || config.ttl < 0) {
      throw new Error('image-proxy: ttl must be a positive number');
    }
    if (typeof config.cacheDir !== 'string') {
      throw new Error('image-proxy: cacheDir must be a string path');
    }
  }
};
