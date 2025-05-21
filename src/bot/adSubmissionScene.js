const { Scenes, Markup } = require('telegraf');
const { AdModel } = require('./models');

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных',
};

const adSubmissionScene = new Scenes.WizardScene(
  'adSubmission',

  // Шаг 1: выбор категории
  async (ctx) => {
    await ctx.reply(
      'Выберите категорию для объявления:',
      Markup.inlineKeyboard(
        Object.entries(categoryMap).map(
          ([key, label]) => Markup.button.callback(label, key)
        ),
        { columns: 1 }
      )
    );
    return ctx.wizard.next();
  },

  // Шаг 2: ввод описания
  (ctx) => {
    // Обработка только кликов по кнопкам
    if (!ctx.callbackQuery || !categoryMap[ctx.callbackQuery.data]) {
      return ctx.reply('Пожалуйста, выберите категорию через кнопки.');
    }
    ctx.session.newAd = { category: ctx.callbackQuery.data };
    // Ответить, что категория выбрана
    ctx.editMessageText(
      `Вы выбрали категорию: ${categoryMap[ctx.callbackQuery.data]}`
    );
    ctx.reply('📝 Введите описание вашего объявления:');
    return ctx.wizard.next();
  },

  // Шаг 3: прикрепление медиа или пропустить
  (ctx) => {
    // Игнорируем команды
    if (ctx.message?.text && ctx.message.text.startsWith('/')) {
      return ctx.reply('Пожалуйста, прикрепите фото/видео/файл или нажмите кнопку "Пропустить".');
    }

    // Кнопка "Пропустить"
    if (ctx.callbackQuery?.data === 'skip_media') {
      ctx.session.newAd.mediaType = null;
      ctx.session.newAd.mediaFileId = null;
      ctx.reply('📍 Укажите местоположение (Страна Город):');
      return ctx.wizard.next();
    }

    // Если прислали фото
    if (ctx.message?.photo) {
      const fileId = ctx.message.photo.pop().file_id;
      ctx.session.newAd.mediaType = 'photo';
      ctx.session.newAd.mediaFileId = fileId;
      ctx.reply('📍 Укажите местоположение (Страна Город):');
      return ctx.wizard.next();
    }

    // Видео
    if (ctx.message?.video) {
      const fileId = ctx.message.video.file_id;
      ctx.session.newAd.mediaType = 'video';
      ctx.session.newAd.mediaFileId = fileId;
      ctx.reply('📍 Укажите местоположение (Страна Город):');
      return ctx.wizard.next();
    }

    // Документ
    if (ctx.message?.document) {
      const fileId = ctx.message.document.file_id;
      ctx.session.newAd.mediaType = 'document';
      ctx.session.newAd.mediaFileId = fileId;
      ctx.reply('📍 Укажите местоположение (Страна Город):');
      return ctx.wizard.next();
    }

    // Если ни медиа, ни "Пропустить"
    ctx.reply(
      'Прикрепите фото/видео/файл или нажмите кнопку "Пропустить".',
      Markup.inlineKeyboard([Markup.button.callback('Пропустить', 'skip_media')])
    );
  },

  // Шаг 4: ввод локации и сохранение объявления
  async (ctx) => {
    // Игнорируем команды
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) {
      return ctx.reply('Пожалуйста, укажите местоположение в формате "Страна Город", без команд.');
    }

    const parts = text.trim().split(/\s+/);
    const country = parts[0];
    const city = parts.slice(1).join(' ') || '';

    ctx.session.newAd.location = { country, city };

    // Сохраняем в базе
    const ad = new AdModel({
      userId: ctx.chat.id,
      category: ctx.session.newAd.category,
      description: ctx.session.newAd.description || '',
      mediaType: ctx.session.newAd.mediaType,
      mediaFileId: ctx.session.newAd.mediaFileId,
      location: ctx.session.newAd.location,
      createdAt: new Date()
    });
    await ad.save();

    await ctx.reply('✅ Ваше объявление добавлено!');
    await ctx.reply('🎉 Возвращаемся в главное меню.', Markup.keyboard([
      ['Подать объявление'],
      ['Объявления в моём городе', 'Фильтр по категории'],
      ['Канал с объявлениями', 'Помощь'],
      ['Мои объявления']
    ]).resize());

    return ctx.scene.leave();
  }
);

module.exports = adSubmissionScene;
