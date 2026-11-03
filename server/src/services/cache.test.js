'use strict';

const { createHash } = require('crypto');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VALID_PARAMS } = require('../constants');
const createCache = require('./cache');

function fakeStrapi() {
  return {
    config: {
      get() {
        return {
          cacheDir: '/tmp/image-proxy-test',
          ttl: 0,
        };
      },
    },
  };
}

/*
 * Key used when Sharp still cropped from a Strapi thumbnail.
 * New keys must differ so those files are not reused.
 */
function thumbnailSourceKey(hash, params) {
  const sorted = {};
  for (const k of Object.keys(params).sort()) {
    if (VALID_PARAMS.has(k)) sorted[k] = params[k];
  }
  const focalMark = params.fpx != null || params.fpy != null ? 'fp2' : '';
  const sig = createHash('md5')
    .update(hash + focalMark + JSON.stringify(sorted))
    .digest('hex');
  return `${hash}-${sig}`;
}

describe('buildKey', () => {
  it('does not reuse cache files that were cropped from a Strapi thumbnail', () => {
    const cache = createCache({ strapi: fakeStrapi() });
    const params = { w: '96', h: '96', fit: 'cover', fpx: '0.5', fpy: '0.41' };
    const key = cache.buildKey('jonas_portrait', params);

    assert.notEqual(key, thumbnailSourceKey('jonas_portrait', params));
  });
});
