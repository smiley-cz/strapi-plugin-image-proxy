'use strict';

//% ============================================
//% Source file for Sharp
//% ============================================

/*
 * Always the original upload. Strapi's thumbnail is a landscape strip
 * already cut from the middle, so a later square crop lands on the face
 * too tight. Small / medium / large have the same problem at other sizes.
 */

/**
 * @param {Record<string, { url?: string, width?: number }> | null | undefined} _formats
 * @param {number} [_targetWidth]
 * @param {number} [_targetHeight]
 * @returns {null}
 */
function pickBestSource(_formats, _targetWidth, _targetHeight) {
  return null;
}

/**
 * URL Sharp should read. Formats are ignored.
 *
 * @param {{ url?: string } | null | undefined} file
 * @param {string} fallback
 * @returns {string}
 */
function sourceUrlFor(file, fallback) {
  return file?.url || fallback;
}

module.exports = { pickBestSource, sourceUrlFor };
