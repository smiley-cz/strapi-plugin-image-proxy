'use strict';

module.exports = [
  {
    method: 'DELETE',
    path: '/image-proxy/cache/:hash',
    handler: 'cache.invalidate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Invalidate all cached variants for a specific image hash'
    }
  },
  {
    method: 'DELETE',
    path: '/image-proxy/cache',
    handler: 'cache.flush',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Flush the entire image proxy cache'
    }
  },
  {
    method: 'GET',
    path: '/image-proxy/cache/stats',
    handler: 'cache.stats',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Return cache file count and total disk size'
    }
  }
];
