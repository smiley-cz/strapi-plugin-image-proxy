'use strict';

/*
 * Shared constants for the image-proxy plugin.
 *
 * To add a new transformation parameter:
 *   1. Add the param name to VALID_PARAMS below
 *   2. Handle it in services/sharp.js process()
 *
 * VALID_PARAMS gates BOTH request handling AND cache key composition,
 * so unknown query params (utm_*, tracking tokens, etc.) cannot pollute
 * the cache.
 */

const VALID_PARAMS = new Set([
  // resize
  'w', 'h', 'fit', 'fpx', 'fpy', 'withoutEnlargement',
  // format
  'f', 'format', 'q', 'lossless', 'effort', 'compressionLevel',
  // color & tone
  'grayscale', 'negate', 'normalize', 'tint', 'gamma',
  // blur & sharpen
  'blur', 'sharpen', 'median',
  // orientation
  'flip', 'flop', 'rotate',
  // metadata retention (opt-in; default is to strip everything)
  'keepMetadata', 'keepExif', 'keepIcc', 'keepXmp',
]);

const VALID_INPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);
const VALID_OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']);

const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', avif: 'image/avif', tiff: 'image/tiff', gif: 'image/gif',
};

module.exports = {
  VALID_PARAMS,
  VALID_INPUT_FORMATS,
  VALID_OUTPUT_FORMATS,
  MIME_MAP,
};
