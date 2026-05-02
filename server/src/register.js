'use strict';

module.exports = ({ strapi }) => {
  const factory = strapi.plugin('image-proxy').middleware('image-proxy');
  const handler = factory({ strapi });
  strapi.server.use((ctx, next) => handler.process(ctx, next));
};
