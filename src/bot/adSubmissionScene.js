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

const mainMenuKeyboard = Markup.keyboard([
  ['Подать объявление'],
  ['Объявления в моём городе', 'Фильтр по категории'],
  ['Канал с объявлениями', 'Помощь'],
  ['Мои объявления']
]).resize();

const adSubmissionScene = new Scenes.BaseScene('adSubmission');

adSubmissionScene.command('cancel', async (ctx) => {
  await ctx.reply('❌ Вы отменили подачу объявления.', mainMenuKeyboard);
  await ctx.scene.leave();
  ctx.session = {};
});

adSubmissionScene.enter(async (ctx) => {
  ctx.session.category = null;
  ctx.session.hintMsgId = null;
  // Показываем кнопки выбора категории
  const catMsg = await ctx.reply('Выберите категорию для подачи объявления:', Markup.inlineKeyboard([
    [Markup.button.callback('Авто', 'category_auto')],
    [Markup.button.callback('Техника', 'category_tech')],
    [Markup.button.callback('Недвижимость', 'category_real_estate')],
    [Markup.button.callback('Одежда/Обувь', 'category_clothing')],
    [Markup.button.callback('Прочее', 'category_other')],
    [Markup.button.callback('Товары для животных', 'category_pets')]
  ]));
  ctx.session.catMsgId = catMsg.message_id;
});

adSubmissionScene.action(/category_(.+)/, async (ctx) => {
  ctx.session.category = ctx.match[1];
  await ctx.answerCbQuery();

  const hintText = `✅ Вы выбрали категорию: <b>${categoryMap[ctx.session.category]}</b>.

1. Введите описание объявления.
2. Прикрепите фото/видео/файл.
3. Контакты (по желанию).
4. Укажите локацию.

Для отмены введите /cancel.`;

  // Если уже была инструкция — попробуй её заменить
  if (ctx.session.hintMsgId) {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.session.hintMsgId,
        undefined,
        hintText,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      // Если не получилось, пробуем удалить старую инструкцию (если она вообще была)
      try { await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.hintMsgId); } catch {}
      // Присылаем новую инструкцию и сохраняем её id
      const m = await ctx.replyWithHTML(hintText);
      ctx.session.hintMsgId = m.message_id;
    }
  } else {
    // Первый раз — просто прислать и сохранить id
    const m = await ctx.replyWithHTML(hintText);
    ctx.session.hintMsgId = m.message_id;
  }
});



adSubmissionScene.on('photo', async (ctx) => {
  const fileId = ctx.message.photo.slice(-1)[0].file_id;
  const caption = ctx.message.caption?.trim();
  if (caption) {
    return await publishAdFromMedia(ctx, 'photo', fileId, caption);
  }
  return await handleMediaWithoutCaption(ctx, 'photo', fileId);
});

adSubmissionScene.on('video', async (ctx) => {
  const fileId = ctx.message.video.file_id;
  const caption = ctx.message.caption?.trim();
  if (caption) {
    return await publishAdFromMedia(ctx, 'video', fileId, caption);
  }
  return await handleMediaWithoutCaption(ctx, 'video', fileId);
});

adSubmissionScene.on('document', async (ctx) => {
  const fileId = ctx.message.document.file_id;
  const caption = ctx.message.caption?.trim();
  if (caption) {
    return await publishAdFromMedia(ctx, 'document', fileId, caption);
  }
  return await handleMediaWithoutCaption(ctx, 'document', fileId);
});

async function handleMediaWithoutCaption(ctx, type, fileId) {
  if (!ctx.session.category) {
    return ctx.reply('❗ Сначала выберите категорию.');
  }
  ctx.session.mediaType = type;
  ctx.session.mediaFileId = fileId;
  ctx.session.awaitingDescriptionConfirmation = true;
  await ctx.reply('❓ Хотите добавить описание к файлу?', Markup.inlineKeyboard([
    [Markup.button.callback('Да', 'confirm_description_yes'), Markup.button.callback('Нет', 'confirm_description_no')]
  ]));
}

async function publishAdFromMedia(ctx, type, fileId, caption) {
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  await publishAd(ctx, { userId, category, description: caption, mediaType: type, mediaFileId: fileId });
  ctx.session = {};
  await ctx.reply('📍 Выберите действие:', mainMenuKeyboard);
  return ctx.scene.leave();
}

adSubmissionScene.action('confirm_description_yes', async (ctx) => {
  ctx.session.awaitingDescription = true;
  ctx.session.awaitingDescriptionConfirmation = false;
  await ctx.answerCbQuery();
  await ctx.reply('✏️ Введите описание:');
});

adSubmissionScene.action('confirm_description_no', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('⚠️ Без описания публикация невозможна. Используйте меню ниже.', mainMenuKeyboard);
  await ctx.scene.leave();
  ctx.session = {};
});

adSubmissionScene.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.chat.id;
  const category = ctx.session.category;
  if (ctx.session.awaitingDescriptionConfirmation) {
    return ctx.reply('❗ Пожалуйста, выберите "Да" или "Нет" на предыдущий вопрос.');
  }
  if (ctx.session.awaitingDescription) {
    ctx.session.awaitingDescription = false;
    const { mediaType, mediaFileId } = ctx.session;
    if (!mediaType || !mediaFileId) {
      await ctx.reply('❗ Ошибка. Попробуйте снова.', mainMenuKeyboard);
      ctx.session = {};
      return ctx.scene.leave();
    }
    await publishAd(ctx, { userId, category, description: text, mediaType, mediaFileId });
    ctx.session = {};
    await ctx.reply('📍 Выберите действие:', mainMenuKeyboard);
    return ctx.scene.leave();
  }
  if (!category) return ctx.reply('❗ Сначала выберите категорию.');
  if (!text || text.startsWith('/')) return ctx.reply('Описание не может быть пустым или начинаться с "/"');
  await publishAd(ctx, { userId, category, description: text });
  ctx.session = {};
  await ctx.reply('📍 Выберите действие:', mainMenuKeyboard);
  ctx.scene.leave();
});

function generateCaption(category, description) {
  const now = new Date();
  const date = now.toLocaleDateString('ru-RU');
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `📢 <b>Новое объявление!</b>\n\n📂 <b>Категория:</b> <i>${categoryMap[category]}</i>\n📝 <b>Описание:</b> ${description}\n\n📅 ${date}, ${time}`;
}

async function publishAd(ctx, { userId, category, description, mediaType = null, mediaFileId = null }) {
  try {
    await new AdModel({ userId, category, description, mediaType, mediaFileId, createdAt: new Date() }).save();
    const user = await UserModel.findOne({ userId });
    if (user) {
      user.adCount++;
      await user.save();
    }
    if (mediaType && mediaFileId) {
      const sendMap = {
        photo: () => ctx.telegram.sendPhoto(CHANNEL_ID, mediaFileId, { caption: generateCaption(category, description), parse_mode: 'HTML' }),
        video: () => ctx.telegram.sendVideo(CHANNEL_ID, mediaFileId, { caption: generateCaption(category, description), parse_mode: 'HTML' }),
        document: () => ctx.telegram.sendDocument(CHANNEL_ID, mediaFileId, { caption: generateCaption(category, description), parse_mode: 'HTML' })
      };
      await sendMap[mediaType]();
    } else {
      await ctx.telegram.sendMessage(CHANNEL_ID, generateCaption(category, description), { parse_mode: 'HTML' });
    }
    await ctx.reply('✅ Объявление добавлено!');
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Не удалось добавить объявление. Попробуйте позже.');
  }
}

module.exports = { adSubmissionScene };
