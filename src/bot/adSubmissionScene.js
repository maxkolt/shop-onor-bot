const { Scenes, Markup } = require('telegraf');
const { UserModel, AdModel } = require('./models');

// ✅ Маппинг категории на русский язык
const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных',
};

// === Функция генерации подписи к объявлению ===
const generateCaption = (type, category, description, location) => {
  const now = new Date();
  const date = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const locationLine = location && location.country !== 'не указано'
    ? `\n📍 <b>Местоположение:</b> ${location.country}, ${location.city}`
    : '';
  return (
    `📢 <b>Новое объявление!</b>\n\n` +
    `📂 <b>Категория:</b> <i>${categoryMap[category] || category}</i>\n` +
    `📝 <b>Описание:</b> ${description}\n\n` +
    `📅 ${date}, ${time}` +
    locationLine
  );
};

// ID канала для публикации
const CHANNEL_ID = -1002364231507;

// Создаём сцену подачи объявления
const adSubmissionScene = new Scenes.BaseScene('adSubmission');

// === Обработка команд внутри сцены ===
// /cancel — выход из сцены
adSubmissionScene.command('cancel', ctx => {
  ctx.reply('🚫 Подача объявления отменена.');
  return ctx.scene.leave();
});
// /setlocation — блокируем и подсказываем отмену
adSubmissionScene.command('setlocation', ctx =>
  ctx.reply('❗ Чтобы изменить локацию, завершите или отмените подачу объявления через /cancel.')
);

// === Вход в сцену: выбор категории ===
adSubmissionScene.enter(async ctx => {
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
  await ctx.reply(
    'Выберите категорию для объявления:',
    Markup.inlineKeyboard(
      Object.entries(categoryMap).map(
        ([key, label]) => Markup.button.callback(label, `category_${key}`)
      ),
      { columns: 1 }
    )
  );
});

// === Выбор категории ===
adSubmissionScene.action(/category_(.+)/, async ctx => {
  const category = ctx.match[1];
  ctx.session.category = category;
  await ctx.reply(
    `Вы выбрали категорию: ${categoryMap[category] || category}.
1. Введите описание вашего объявления.
2. Прикрепите, если нужно, фото, видео или файл.
3. Оставьте контактные данные (по желанию).
4. Укажите, где вы находитесь (страна, город).`
  );
});

// === Обработка текстового описания ===
adSubmissionScene.on('text', async ctx => {
  const text = ctx.message.text;
  if (text.startsWith('/')) {
    return ctx.reply('❗ Чтобы отменить подачу объявления, нажмите /cancel.');
  }
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = text.trim();
  if (!category) {
    await ctx.reply('Ошибка: выберите категорию перед вводом описания.');
    return ctx.scene.leave();
  }
  if (!description) {
    return ctx.reply('Описание не может быть пустым.');
  }
  try {
    const ad = new AdModel({ userId, category, description, createdAt: new Date() });
    await ad.save();
    const user = await UserModel.findOne({ userId });
    user.adCount += 1;
    await user.save();
    const post = generateCaption('text', category, description, user.location);
    await ctx.telegram.sendMessage(CHANNEL_ID, post, { parse_mode: 'HTML' });
    await ctx.reply('✅ Ваше объявление добавлено!');
  } catch (err) {
    console.error('Ошибка при добавлении текста:', err);
    await ctx.reply('Ошибка при сохранении или отправке. Попробуйте позже.');
  }
  return ctx.scene.leave();
});

// === Обработка фото ===
adSubmissionScene.on('photo', async ctx => {
  const caption = ctx.message.caption;
  if (caption && caption.startsWith('/')) {
    return ctx.reply('❗ Чтобы отменить подачу объявления, нажмите /cancel.');
  }
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = caption || '';
  if (!category) {
    await ctx.reply('Ошибка: выберите категорию перед отправкой фото.');
    return ctx.scene.leave();
  }
  try {
    const fileId = ctx.message.photo.pop().file_id;
    const ad = new AdModel({ userId, category, description, mediaType: 'photo', mediaFileId: fileId, createdAt: new Date() });
    await ad.save();
    const user = await UserModel.findOne({ userId });
    user.adCount += 1;
    await user.save();
    const post = generateCaption('photo', category, description, user.location);
    await ctx.telegram.sendPhoto(CHANNEL_ID, fileId, { caption: post, parse_mode: 'HTML' });
    await ctx.reply('✅ Ваше объявление добавлено!');
  } catch (err) {
    console.error('Ошибка при отправке фото:', err);
    await ctx.reply('Ошибка при публикации фото. Попробуйте позже.');
  }
  return ctx.scene.leave();
});

// === Обработка видео ===
adSubmissionScene.on('video', async ctx => {
  const caption = ctx.message.caption;
  if (caption && caption.startsWith('/')) {
    return ctx.reply('❗ Чтобы отменить подачу объявления, нажмите /cancel.');
  }
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = caption || '';
  if (!category) {
    await ctx.reply('Ошибка: выберите категорию перед отправкой видео.');
    return ctx.scene.leave();
  }
  try {
    const fileId = ctx.message.video.file_id;
    const user = await UserModel.findOne({ userId });
    const post = generateCaption('video', category, description, user.location);
    await ctx.telegram.sendVideo(CHANNEL_ID, fileId, { caption: post, parse_mode: 'HTML' });
    user.adCount += 1;
    await user.save();
    await ctx.reply('✅ Ваше объявление добавлено!');
  } catch (err) {
    console.error('Ошибка при отправке видео:', err);
    await ctx.reply('Ошибка при публикации видео. Попробуйте позже.');
  }
  return ctx.scene.leave();
});

// === Обработка документа ===
adSubmissionScene.on('document', async ctx => {
  const caption = ctx.message.caption;
  if (caption && caption.startsWith('/')) {
    return ctx.reply('❗ Чтобы отменить подачу объявления, нажмите /cancel.');
  }
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  const description = caption || '';
  if (!category) {
    await ctx.reply('Ошибка: выберите категорию перед отправкой файла.');
    return ctx.scene.leave();
  }
  try {
    const fileId = ctx.message.document.file_id;
    const ad = new AdModel({ userId, category, description, mediaType: 'document', mediaFileId: fileId, createdAt: new Date() });
    await ad.save();
    const user = await UserModel.findOne({ userId });
    user.adCount += 1;
    await user.save();
    const post = generateCaption('document', category, description, user.location);
    await ctx.telegram.sendDocument(CHANNEL_ID, fileId, { caption: post, parse_mode: 'HTML' });
    await ctx.reply('✅ Ваше объявление добавлено!');
  } catch (err) {
    console.error('Ошибка при отправке документа:', err);
    await ctx.reply('Ошибка при публикации файла. Попробуйте позже.');
  }
  return ctx.scene.leave();
});

module.exports = adSubmissionScene;
