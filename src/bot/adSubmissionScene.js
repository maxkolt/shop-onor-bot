const { Scenes, Markup } = require('telegraf');
const { AdModel } = require('./models');

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных'
};

const adSubmissionScene = new Scenes.WizardScene(
  'adSubmission',
  async (ctx) => {
    await ctx.reply('Выберите категорию:', Markup.inlineKeyboard([
      [Markup.button.callback(categoryMap.auto, 'cat_auto')],
      [Markup.button.callback(categoryMap.tech, 'cat_tech')],
      [Markup.button.callback(categoryMap.real_estate, 'cat_real_estate')],
      [Markup.button.callback(categoryMap.clothing, 'cat_clothing')],
      [Markup.button.callback(categoryMap.other, 'cat_other')],
      [Markup.button.callback(categoryMap.pets, 'cat_pets')]
    ]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('cat_')) {
      return ctx.reply('❗ Пожалуйста, выберите категорию с помощью кнопки.');
    }
    ctx.session.category = ctx.callbackQuery.data.replace('cat_', '');
    await ctx.answerCbQuery();
    await ctx.reply('📄 Отправьте описание объявления (до 1000 символов):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return ctx.reply('❗ Пожалуйста, введите текстовое описание.');
    }
    ctx.session.description = ctx.message.text.trim().slice(0, 1000);
    await ctx.reply('📎 Теперь отправьте фото, видео или документ для объявления:');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const file = ctx.message?.photo?.slice(-1)[0]
      || ctx.message?.video
      || ctx.message?.document;

    if (!file || !file.file_id) {
      return ctx.reply('❗ Отправьте фото, видео или документ.');
    }

    const mediaType = ctx.message.photo ? 'photo' :
      ctx.message.video ? 'video' :
        ctx.message.document ? 'document' : null;

    const ad = new AdModel({
      userId: ctx.chat.id,
      category: ctx.session.category,
      description: ctx.session.description,
      mediaType,
      mediaFileId: file.file_id,
      createdAt: new Date()
    });

    await ad.save();

    delete ctx.session.category;
    delete ctx.session.description;

    await ctx.reply('✅ Объявление отправлено на модерацию.');
    return ctx.scene.leave();
  }
);

adSubmissionScene.command('cancel', async (ctx) => {
  delete ctx.session.category;
  delete ctx.session.description;
  await ctx.reply('❌ Подача объявления отменена.');
  return ctx.scene.leave();
});

adSubmissionScene.use(async (ctx, next) => {
  const text = ctx.message?.text;
  if (text === '/cancel') return next();

  if (!ctx.session.category && ctx.wizard.cursor > 0) {
    return ctx.reply('❗ Сначала выберите категорию.');
  }

  return next();
});

module.exports = { adSubmissionScene };
