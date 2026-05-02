'use strict';

module.exports = ({ strapi }) => {
  strapi.server.use(async (ctx, next) => {
    const middleware = strapi.plugin('image-proxy').middleware('image-proxy');
    return middleware.process(ctx, next);
  });
};
