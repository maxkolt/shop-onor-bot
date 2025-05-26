// restoreState.js
module.exports = (ctx, next) => {
  if (!ctx.session) {
    ctx.session = {};  // Создаем сессию, если она не существует
  }
  return next();
};
