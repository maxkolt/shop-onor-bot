const { Scenes, Markup } = require('telegraf');
const { UserModel, AdModel } = require('./models');

const CHANNEL_ID = -1002364231507; // Заменить, если используешь chat_id

const adSubmissionScene = new Scenes.BaseScene('adSubmission');

// === ВХОД В СЦЕНУ ===
adSubmissionScene.enter(async (ctx) => {
  const userId = ctx.chat.id;

  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({ userId, adCount: 0, hasSubscription: false });
    await user.save();
  }

  await ctx.reply(
    'Выберите категорию для объявления:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Авто', 'category_auto')],
      [Markup.button.callback('Техника', 'category_tech')],
      [Markup.button.callback('Недвижимость', 'category_real_estate')],
      [Markup.button.callback('Одежда/Обувь', 'category_clothing')],
      [Markup.button.callback('Прочее', 'category_other')],
      [Markup.button.callback('Товары для животных', 'category_pets')],
    ])
  );
});

// === ВЫБОР КАТЕГОРИИ ===
adSubmissionScene.action(/category_(.+)/, async (ctx) => {
  const category = ctx.match[1];
  ctx.session.category = category;

  await ctx.reply(
    `Вы выбрали категорию: ${category}.
1. Введите описание вашего объявления.
2. Прикрепите, если нужно, фото, видео или файл.
3. Оставьте ваши контактные данные.`
  );
});

// === ОБЩАЯ ФУНКЦИЯ ПОДПИСИ ===
const generateCaption = (type, category, description, username) => {
  const now = new Date();
  const date = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `📢 <b>Новое объявление!</b> ${date}\n\n` +
    `📂 <b>Категория:</b> ${category}\n` +
    `📝 <b>Описание:</b> ${description}\n` +
    `👤 <b>Пользователь:</b> @${username}`;
};

// === ОБРАБОТКА ТЕКСТА ===
adSubmissionScene.on('text', async (ctx) => {
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = ctx.message.text;

  if (!category) {
    await ctx.reply('Ошибка: выберите категорию перед описанием.');
    return ctx.scene.leave();
  }

  if (!description || description.trim() === '') {
    await ctx.reply('Описание не может быть пустым.');
    return;
  }

  try {
    const ad = new AdModel({ userId, category, description, createdAt: new Date() });
    await ad.save();

    const user = await UserModel.findOne({ userId });
    user.adCount += 1;
    await user.save();

    const username = ctx.from.username || `id${ctx.from.id}`;
    const post = generateCaption('text', category, description, username);

    await ctx.telegram.sendMessage(CHANNEL_ID, post, { parse_mode: 'HTML' });

    await ctx.reply('Ваше объявление добавлено!');
  } catch (error) {
    console.error('❌ Ошибка при добавлении текста:', error.message);
    await ctx.reply('Ошибка при сохранении или отправке. Попробуйте позже.');
  }

  ctx.scene.leave();
});

// === ОБРАБОТКА ФОТО ===
adSubmissionScene.on('photo', async (ctx) => {
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = ctx.message.caption || 'Описание отсутствует';
  const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (!category) {
    await ctx.reply('Ошибка: выберите категорию перед отправкой фото.');
    return ctx.scene.leave();
  }

  try {
    const ad = new AdModel({
      userId,
      category,
      description,
      mediaType: 'photo',
      mediaFileId: photo,
      createdAt: new Date(),
    });
    await ad.save();

    const user = await UserModel.findOne({ userId });
    user.adCount += 1;
    await user.save();

    const username = ctx.from.username || `id${ctx.from.id}`;
    const caption = generateCaption('photo', category, description, username);

    await ctx.telegram.sendPhoto(CHANNEL_ID, photo, {
      caption,
      parse_mode: 'HTML',
    });

    await ctx.reply('Объявление добавлено!');
  } catch (error) {
    console.error('❌ Ошибка при отправке фото:', error.message);
    await ctx.reply('Ошибка при публикации фото. Попробуйте позже.');
  }

  ctx.scene.leave();
});

// === ОБРАБОТКА ВИДЕО ===
adSubmissionScene.on('video', async (ctx) => {
  const category = ctx.session.category;
  const video = ctx.message.video.file_id;
  const description = ctx.message.caption || 'Описание отсутствует';
  const username = ctx.from.username || `id${ctx.from.id}`;

  if (!category) {
    await ctx.reply('Выберите категорию перед отправкой видео.');
    return ctx.scene.leave();
  }

  try {
    const caption = generateCaption('video', category, description, username);

    await ctx.telegram.sendVideo(CHANNEL_ID, video, {
      caption,
      parse_mode: 'HTML',
    });

    await ctx.reply('Объявление добавлено!');
  } catch (error) {
    console.error('❌ Ошибка при отправке видео:', error.message);
    await ctx.reply('Ошибка при публикации видео. Попробуйте позже.');
  }

  ctx.scene.leave();
});

// === ОБРАБОТКА ДОКУМЕНТА ===
adSubmissionScene.on('document', async (ctx) => {
  const category = ctx.session.category;
  const doc = ctx.message.document.file_id;
  const description = ctx.message.caption || 'Описание отсутствует';
  const username = ctx.from.username || `id${ctx.from.id}`;

  if (!category) {
    await ctx.reply('Выберите категорию перед отправкой файла.');
    return ctx.scene.leave();
  }

  try {
    const caption = generateCaption('document', category, description, username);

    await ctx.telegram.sendDocument(CHANNEL_ID, doc, {
      caption,
      parse_mode: 'HTML',
    });

    await ctx.reply('Объявление добавлено!');
  } catch (error) {
    console.error('❌ Ошибка при отправке документа:', error.message);
    await ctx.reply('Ошибка при публикации файла. Попробуйте позже.');
  }

  ctx.scene.leave();
});

module.exports = { adSubmissionScene };
