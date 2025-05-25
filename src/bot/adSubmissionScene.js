const { Scenes, Markup } = require('telegraf');
const { UserModel, AdModel } = require('./models');

// Карта категорий
const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных'
};

// Получаем ID канала из переменной окружения
const CHANNEL_ID = process.env.CHANNEL_ID;

// Главное меню
const mainMenuKeyboard = Markup.keyboard([
  ['Подать объявление'],
  ['Объявления в моём городе', 'Фильтр по категории'],
  ['Канал с объявлениями', 'Помощь'],
  ['Мои объявления']
]).resize();

// Утилита для генерации текста объявления
function generateCaption(category, description) {
  const title = categoryMap[category] || '📦 Без категории';
  return `<b>${title}</b>\n📝 ${description}`;
}

// Сцена подачи объявления
const adSubmissionScene = new Scenes.BaseScene('adSubmission');

// Отмена сцены, если нажаты кнопки главного меню до выбора категории
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
    return;
  }
  if (text?.startsWith('/') && text !== '/cancel') {
    return ctx.reply('⛔ Команды недоступны во время подачи объявления. Введите описание или воспользуйтесь кнопками.');
  }
  return next();
});

// Вход в сцену
adSubmissionScene.enter(async (ctx) => {
  delete ctx.session.category;
  delete ctx.session.description;
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
  await ctx.answerCbQuery();
  await ctx.reply(
    `Вы выбрали категорию: ${categoryMap[ctx.session.category]}.
1. Введите описание объявления.
2. Прикрепите фото/видео/файл (опционально).
3. Укажите контакты и город (если нужно).

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

  ctx.session.description = text; // сохраняем в сессию для использования при отправке медиа
  await ctx.reply('📎 Теперь отправьте файл (фото, видео или документ), если хотите. Или снова нажмите любую кнопку меню для завершения.');
});

// Обработка медиафайлов
async function handleMedia(ctx, type, fileId) {
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = ctx.session.description || '';

  if (!category || !description) {
    return ctx.reply('❗ Сначала введите описание объявления текстом.');
  }

  try {
    await new AdModel({ userId, category, description, mediaType: type, mediaFileId: fileId, createdAt: new Date() }).save();

    const user = await UserModel.findOne({ userId });
    user.adCount++;
    await user.save();

    const caption = generateCaption(category, description);
    switch (type) {
      case 'photo':
        await ctx.telegram.sendPhoto(CHANNEL_ID, fileId, { caption, parse_mode: 'HTML' });
        break;
      case 'video':
        await ctx.telegram.sendVideo(CHANNEL_ID, fileId, { caption, parse_mode: 'HTML' });
        break;
      case 'document':
        await ctx.telegram.sendDocument(CHANNEL_ID, fileId, { caption, parse_mode: 'HTML' });
        break;
    }

    await ctx.reply('✅ Объявление добавлено и опубликовано!', mainMenuKeyboard);
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Не удалось добавить объявление. Попробуйте позже.');
  }

  delete ctx.session.category;
  delete ctx.session.description;
  await ctx.scene.leave();
}

adSubmissionScene.on('photo', ctx => handleMedia(ctx, 'photo', ctx.message.photo.slice(-1)[0].file_id));
adSubmissionScene.on('video', ctx => handleMedia(ctx, 'video', ctx.message.video.file_id));
adSubmissionScene.on('document', ctx => handleMedia(ctx, 'document', ctx.message.document.file_id));

module.exports = { adSubmissionScene };
