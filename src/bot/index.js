require('dotenv').config();

const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const adSubmissionScene = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных',
};

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = 'https://boroxlo-bot-tg.onrender.com';

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ BOT_TOKEN или MONGO_URI не установлены в .env');
  process.exit(1);
}

// Подключение к MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch(err => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

// === Middleware: блокировка /setlocation внутри сцены подачи объявления ===
bot.use((ctx, next) => {
  if (ctx.scene.current && ctx.scene.current.id === 'adSubmission') {
    return ctx.reply(
      '❗ Чтобы изменить локацию — закончите сначала ввод объявления или отмените его командой /cancel.'
    );
  }
  return next();
});

// === Вспомогательная функция: главное меню ===
function mainKeyboard() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ]).resize();
}

// === Команда /start ===
bot.command('start', async ctx => {
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

  if (!user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply(
      '📍 Пожалуйста, укажите местоположение (Страна Город):',
      Markup.removeKeyboard()
    );
  }

  ctx.session.awaitingLocationInput = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню для управления:', mainKeyboard());
});

// === Команда /setlocation ===
bot.command('setlocation', async ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply(
    '📍 Пожалуйста, укажите местоположение (Страна Город):',
    Markup.removeKeyboard()
  );
});

// === Обработчик текстовых сообщений ===
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // прочие команды

    const parts = text.split(/[\s,\.]+/).filter(Boolean);
    let country = 'не указано';
    let city = 'не указано';

    if (parts.length === 1) {
      city = parts[0];
    } else {
      country = parts[0];
      city = parts.slice(1).join(' ');
    }

    const user = await UserModel.findOne({ userId: ctx.chat.id });
    user.location = { country, city };
    await user.save();

    ctx.session.awaitingLocationInput = false;
    await ctx.reply(`✅ Локация сохранена: ${country}, ${city}`);
    return ctx.reply('🎉 Добро пожаловать! Используйте меню для управления:', mainKeyboard());
  }
  return next();
});

// === Middleware: блокировка меню при ожидании локации ===
bot.use((ctx, next) => {
  if (ctx.session.awaitingLocationInput && ctx.updateType === 'message') {
    return ctx.reply(
      '⚠️ Сначала укажите страну и город, например: Россия Москва'
    );
  }
  return next();
});

// === Основные хендлеры ===
bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Канал с объявлениями', ctx =>
  ctx.reply(
    'Сюда 👇',
    Markup.inlineKeyboard([
      Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
    ])
  )
);
bot.hears('Помощь', ctx =>
  ctx.reply('По всем вопросам обращайтесь к администратору: @max12kolt')
);

bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('У вас пока нет опубликованных объявлений.');

  for (const ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo') {
      await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, {
        caption: cap,
        parse_mode: 'HTML'
      });
    } else if (ad.mediaType === 'video') {
      await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, {
        caption: cap,
        parse_mode: 'HTML'
      });
    } else if (ad.mediaType === 'document') {
      await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, {
        caption: cap,
        parse_mode: 'HTML'
      });
    } else {
      await ctx.replyWithHTML(cap);
    }
  }
});

// Пагинация и показ объявлений по городу
async function sendCityAds(ctx, categoryFilter = null) {
  const user = await UserModel.findOne({ userId: ctx.chat.id });
  if (!user || !user.location || !user.location.city || user.location.city === 'не указано') {
    ctx.session.cityAdOffset = 0;
    ctx.session.awaitingLocationInput = true;
    return ctx.reply(
      '⚠️ Укажите местоположение через /setlocation, например: Россия Москва'
    );
  }

  const cityQuery = user.location.city.toLowerCase();
  const countryQuery = user.location.country.toLowerCase();
  const offset = ctx.session.cityAdOffset || 0;
  const allAds = await AdModel.find({}).sort({ createdAt: -1 });

  const filtered = allAds.filter(ad =>
    ad.location.country.toLowerCase() === countryQuery &&
    ad.location.city.toLowerCase() === cityQuery &&
    (!categoryFilter || ad.category === categoryFilter)
  );

  const pagedAds = filtered.slice(offset, offset + 5);

  if (!pagedAds.length) {
    return ctx.reply('📭 Нет объявлений в вашем городе или категории.');
  }

  for (const ad of pagedAds) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo') {
      await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, {
        caption: cap,
        parse_mode: 'HTML'
      });
    } else if (ad.mediaType === 'video') {
      await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, {
        caption: cap,
        parse_mode: 'HTML'
      });
    } else if (ad.mediaType === 'document') {
      await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, {
        caption: cap,
        parse_mode: 'HTML'
      });
    } else {
      await ctx.replyWithHTML(cap);
    }
  }

  ctx.session.cityAdOffset = offset + pagedAds.length;
  if (offset + pagedAds.length < filtered.length) {
    await ctx.reply(
      '⬇️ Показать ещё?',
      Markup.inlineKeyboard([Markup.button.callback('Показать ещё', 'more_city_ads')])
    );
  } else {
    ctx.session.cityAdOffset = 0;
  }
}

bot.action('more_city_ads', ctx => sendCityAds(ctx));
bot.hears('Объявления в моём городе', ctx => sendCityAds(ctx));
bot.hears('Фильтр по категории', ctx =>
  ctx.reply(
    'Выберите категорию для фильтрации:',
    Markup.inlineKeyboard(Object.entries(categoryMap).map(
      ([key, label]) => Markup.button.callback(label, `filter_${key}`)
    ), { columns: 2 })
  )
);
bot.action(/filter_(.+)/, (ctx) => {
  const category = ctx.match[1];
  return sendCityAds(ctx, category);
});

bot.catch(err => console.error('❌ Ошибка:', err));

const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log('Webhook установлен');
  } catch (e) {
    console.error('Ошибка webhook:', e.message);
  }
});
