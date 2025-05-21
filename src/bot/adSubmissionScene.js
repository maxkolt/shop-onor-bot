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
const adSubmissionScene = new Scenes.BaseScene('adSubmission');

// /cancel
adSubmissionScene.command('cancel', async (ctx) => {
  delete ctx.session.category;
  await ctx.reply('❌ Подача объявления отменена. Возвращаемся в меню.', Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ]).resize());
  return ctx.scene.leave();
});

// Блокировка команд
adSubmissionScene.use((ctx, next) => {
  const txt = ctx.message?.text || '';
  if (txt.startsWith('/')) {
    return ctx.reply('⛔ Команды недоступны во время подачи объявления. Введите описание или используйте кнопки.');
  }
  return next();
});

// Вход в сцену
adSubmissionScene.enter(async (ctx) => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({
      userId,
      adCount: 0,
      hasSubscription: false,
      location: { country: 'не указано', city: 'не указано' }
    });
    await user.save();
  }

  await ctx.reply('Выберите категорию для объявления:', Markup.inlineKeyboard([
    [Markup.button.callback('Авто', 'category_auto')],
    [Markup.button.callback('Техника', 'category_tech')],
    [Markup.button.callback('Недвижимость', 'category_real_estate')],
    [Markup.button.callback('Одежда/Обувь', 'category_clothing')],
    [Markup.button.callback('Прочее', 'category_other')],
    [Markup.button.callback('Товары для животных', 'category_pets')]
  ]));
});

// Выбор категории
adSubmissionScene.action(/category_(.+)/, async (ctx) => {
  ctx.session.category = ctx.match[1];
  await ctx.reply(
    `Вы выбрали категорию: ${categoryMap[ctx.session.category]}.
` +
    `1. Введите описание объявления.
2. Прикрепите фото/видео/файл.
` +
    `3. (Опционально) Контакты.
4. Укажите локацию (страна, город).

` +
    `Для отмены введите /cancel`
  );
});

// Генерация подписи
const generateCaption = (category, description) => {
  const now = new Date();
  const date = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `📢 <b>Новое объявление!</b>

📂 <b>Категория:</b> <i>${categoryMap[category]}</i>
📝 <b>Описание:</b> ${description}

📅 ${date}, ${time}`;
};

// Обработка текста
adSubmissionScene.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.chat.id;
  const category = ctx.session.category;

  const forbiddenMenuInputs = [
    'Объявления в моём городе',
    'Фильтр по категории',
    'Канал с объявлениями',
    'Помощь',
    'Мои объявления',
    'Подать объявление'
  ];

  if (forbiddenMenuInputs.includes(text)) {
    delete ctx.session.category;
    await ctx.scene.leave();
    return ctx.telegram.handleUpdate({
      ...ctx.update,
      message: { ...ctx.message, text }
    }, ctx.telegram);
  }

  if (!category) return ctx.reply('❗ Сначала выберите категорию.');
  if (!text || text.startsWith('/')) return ctx.reply('❌ Описание не может быть пустым или начинаться с "/"');

  try {
    await new AdModel({ userId, category, description: text, createdAt: new Date() }).save();
    const user = await UserModel.findOne({ userId });
    user.adCount++;
    await user.save();

    await ctx.telegram.sendMessage(CHANNEL_ID, generateCaption(category, text), { parse_mode: 'HTML' });
    await ctx.reply('✅ Объявление добавлено!');
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

  if (!category) {
    await ctx.reply('❗ Сначала выберите категорию.');
    return ctx.scene.leave();
  }

  const description = ctx.message.caption?.trim() || 'Описание отсутствует';
  await new AdModel({ userId, category, description, mediaType: type, mediaFileId: fileId, createdAt: new Date() }).save();
  const user = await UserModel.findOne({ userId });
  user.adCount++;
  await user.save();

  const sendMap = {
    photo: () => ctx.telegram.sendPhoto(CHANNEL_ID, fileId, { caption: generateCaption(category, description), parse_mode: 'HTML' }),
    video: () => ctx.telegram.sendVideo(CHANNEL_ID, fileId, { caption: generateCaption(category, description), parse_mode: 'HTML' }),
    document: () => ctx.telegram.sendDocument(CHANNEL_ID, fileId, { caption: generateCaption(category, description), parse_mode: 'HTML' })
  };

  await sendMap[type]();
  await ctx.reply('✅ Объявление добавлено!');
  delete ctx.session.category;
  ctx.scene.leave();
}

adSubmissionScene.on('photo', ctx => handleMedia(ctx, 'photo', ctx.message.photo.slice(-1)[0].file_id));
adSubmissionScene.on('video', ctx => handleMedia(ctx, 'video', ctx.message.video.file_id));
adSubmissionScene.on('document', ctx => handleMedia(ctx, 'document', ctx.message.document.file_id));

module.exports = { adSubmissionScene };
