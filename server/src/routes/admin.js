'use strict';

/*
 * Strapi auto-prefixes plugin routes with `/${pluginName}` (i.e. `/image-proxy`),
 * so paths here are relative to that prefix. Final URLs:
 *   DELETE /image-proxy/cache/:hash
 *   DELETE /image-proxy/cache
 *   GET    /image-proxy/cache/stats
 */
module.exports = [
  {
    method: 'DELETE',
    path: '/cache/:hash',
    handler: 'cache.invalidate',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Invalidate all cached variants for a specific image hash',
    },
  },
  {
    method: 'DELETE',
    path: '/cache',
    handler: 'cache.flush',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Flush the entire image proxy cache',
    },
  },
  {
    method: 'GET',
    path: '/cache/stats',
    handler: 'cache.stats',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Return cache file count and total disk size',
    },
  },
];
