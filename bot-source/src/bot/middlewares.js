const restoreState = async (ctx, next) => {
  if (!ctx.session) {
    ctx.session = {};
  }
  await next();
};

module.exports = { restoreState };
