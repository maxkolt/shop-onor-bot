const { Scenes, Markup } = require('telegraf');
const { UserModel, AdModel } = require('./models');

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных'
};

const CHANNEL_ID = -1002364231507;

// Главное меню (общая клавиатура)
const mainMenuKeyboard = Markup.keyboard([
  ['Подать объявление'],
  ['Объявления в моём городе', 'Фильтр по категории'],
  ['Канал с объявлениями', 'Помощь'],
  ['Мои объявления']
]).resize();

// Сцена подачи объявления
const adSubmissionScene = new Scenes.BaseScene('adSubmission');

// Переход по любой кнопке меню до выбора категории — отмена сцены
adSubmissionScene.use(async (ctx, next) => {
  const text = ctx.message?.text;
  const menuButtons = [
    'Подать объявление',
    'Объявления в моём городе',
    'Фильтр по категории',
    'Канал с объявлениями',
    'Помощь',
    'Мои объявления'
  ];
  if (text && menuButtons.includes(text) && !ctx.session.category) {
    await ctx.reply('❌ Вы отменили подачу объявления. Сделайте выбор используя кнопки:', mainMenuKeyboard);
    await ctx.scene.leave();
    return; // отменили, не продолжаем сцену
  }
  // запрет команд во время подачи, кроме /cancel
  const txt = ctx.message?.text || '';
  if (txt.startsWith('/') && txt !== '/cancel') {
    return ctx.reply('⛔ Команды недоступны во время подачи объявления. Введите описание или воспользуйтесь кнопками.');
  }
  return next();
});

// Вход в сцену: выбор категории
adSubmissionScene.enter(async (ctx) => {
  delete ctx.session.category;
  await ctx.reply(
    'Выберите категорию для подачи объявления:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Авто', 'category_auto')],
      [Markup.button.callback('Техника', 'category_tech')],
      [Markup.button.callback('Недвижимость', 'category_real_estate')],
      [Markup.button.callback('Одежда/Обувь', 'category_clothing')],
      [Markup.button.callback('Прочее', 'category_other')],
      [Markup.button.callback('Товары для животных', 'category_pets')]
    ])
  );
});

// Обработка выбора категории
adSubmissionScene.action(/category_(.+)/, async (ctx) => {
  ctx.session.category = ctx.match[1];
  await ctx.reply(
    `Вы выбрали категорию: ${categoryMap[ctx.session.category]}.
1. Введите описание объявления.
2. Прикрепите фото/видео/файл.
3. (Опционально) Контакты.
4. Укажите локацию (страна, город).

Для отмены введите /cancel`,
    { reply_markup: { remove_keyboard: true } }
  );
});

// Обработка текста (описание)
adSubmissionScene.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.chat.id;
  const category = ctx.session.category;

  if (!category) return ctx.reply('❗ Сначала выберите категорию.');
  if (!text || text.startsWith('/')) return ctx.reply('❌ Описание не может быть пустым или начинаться с "/"');

  try {
    await new AdModel({ userId, category, description: text, createdAt: new Date() }).save();
    const user = await UserModel.findOne({ userId });
    user.adCount++;
    await user.save();

    await ctx.telegram.sendMessage(CHANNEL_ID, generateCaption(category, text), { parse_mode: 'HTML' });
    await ctx.reply('✅ Объявление добавлено!', mainMenuKeyboard);
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Не удалось добавить объявление. Попробуйте позже.');
  }

  delete ctx.session.category;
  ctx.scene.leave();
});

// Обработка медиа
async function handleMedia(ctx, type, fileId) {
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  if (!category) return ctx.reply('❗ Сначала выберите категорию.');

  const description = ctx.session.description || '';
  const user = await UserModel.findOne({ userId });
  user.adCount++;
  await user.save();

  const sendMap = {
    photo:    () => ctx.telegram.sendPhoto(CHANNEL_ID, fileId,    { caption: generateCaption(category, description), parse_mode: 'HTML' }),
    video:    () => ctx.telegram.sendVideo(CHANNEL_ID, fileId,    { caption: generateCaption(category, description), parse_mode: 'HTML' }),
    document: () => ctx.telegram.sendDocument(CHANNEL_ID, fileId, { caption: generateCaption(category, description), parse_mode: 'HTML' }),
  };
  await sendMap[type]();

  await ctx.reply('✅ Объявление добавлено!', mainMenuKeyboard);
  delete ctx.session.category;
  ctx.scene.leave();
}

adSubmissionScene.on('photo',    ctx => handleMedia(ctx, 'photo',    ctx.message.photo.slice(-1)[0].file_id));
adSubmissionScene.on('video',    ctx => handleMedia(ctx, 'video',    ctx.message.video.file_id));
adSubmissionScene.on('document', ctx => handleMedia(ctx, 'document', ctx.message.document.file_id));

module.exports = { adSubmissionScene };
