'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickBestSource, sourceUrlFor } = require('./source');

const ORIGINAL = '/uploads/jonas_portrait.jpg';
const THUMBNAIL = '/uploads/thumbnail_jonas_portrait.jpg';

const file = {
  url: ORIGINAL,
  formats: {
    thumbnail: { url: THUMBNAIL, width: 245, height: 156 },
    small: { url: '/uploads/small_jonas_portrait.jpg', width: 500, height: 750 },
  },
};

describe('pickBestSource', () => {
  it('does not use Strapi thumbnail or other generated formats', () => {
    assert.equal(pickBestSource(file.formats, 96, 96), null);
    assert.equal(pickBestSource(file.formats, 28, 28), null);
    assert.equal(pickBestSource(file.formats, 192, 192), null);
  });
});

describe('sourceUrlFor', () => {
  it('returns the original upload even when a thumbnail would cover the square', () => {
    assert.equal(sourceUrlFor(file, '/uploads/fallback.jpg'), ORIGINAL);
    assert.equal(sourceUrlFor({ ...file, url: '' }, '/uploads/fallback.jpg'), '/uploads/fallback.jpg');
  });
});
