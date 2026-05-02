'use strict';

module.exports = ({ strapi }) => {
  const middleware = strapi.plugin('image-proxy').middleware('image-proxy');
  strapi.server.use((ctx, next) => middleware.process(ctx, next));
};
