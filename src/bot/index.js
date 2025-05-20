require('dotenv').config();

const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const adSubmissionScene = require('./adSubmissionScene');
const { categoryMap } = require('./utils');
const { UserModel, AdModel } = require('./models');

// === Конфигурация ===
const BOT_TOKEN   = process.env.BOT_TOKEN;
const MONGO_URI   = process.env.MONGO_URI;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT        = process.env.PORT || 10000;

if (!BOT_TOKEN || !MONGO_URI || !WEBHOOK_URL) {
  console.error('❌ Не заданы BOT_TOKEN, MONGO_URI или WEBHOOK_URL');
  process.exit(1);
}

// Подключаемся к Mongo
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch(err => { console.error('❌ Ошибка подключения:', err.message); process.exit(1); });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Сцена подачи объявления
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

// Блокируем только /setlocation внутри сцены
bot.use((ctx, next) => {
  if (
    ctx.scene.current?.id === 'adSubmission' &&
    ctx.updateType === 'message' &&
    ctx.message.text === '/setlocation'
  ) {
    return ctx.reply('❗ Чтобы изменить локацию — завершите подачу объявления /cancel.');
  }
  return next();
});

// Главное меню (ReplyKeyboard)
function mainKeyboard() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями',      'Помощь'],
    ['Мои объявления']
  ]).resize();
}

// /start
bot.command('start', async ctx => {
  if (ctx.scene.current) await ctx.scene.leave();

  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({
      userId, adCount: 0, hasSubscription: false,
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
  return ctx.reply(
    '🎉 Добро пожаловать! Используйте меню для управления:',
    mainKeyboard()
  );
});

// /setlocation
bot.command('setlocation', ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply(
    '📍 Пожалуйста, укажите местоположение (Страна Город):',
    Markup.removeKeyboard()
  );
});

// Сохраняем локацию
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const t = ctx.message.text.trim();
    if (t.startsWith('/')) return;
    const parts = t.split(/\s+/), [country, ...city] = parts;
    const user = await UserModel.findOne({ userId: ctx.chat.id });
    user.location = { country, city: city.join(' ') };
    await user.save();

    ctx.session.awaitingLocationInput = false;
    await ctx.reply(`✅ Локация сохранена: ${country}, ${city.join(' ')}`);
    return ctx.reply('🎉 Добро пожаловать! Используйте меню для управления:', mainKeyboard());
  }
  return next();
});

// Блокируем всё остальное при ожидании локации
bot.use((ctx, next) => {
  if (ctx.session.awaitingLocationInput && ctx.updateType === 'message') {
    return ctx.reply('⚠️ Сначала укажите страну и город, например: Россия Москва');
  }
  return next();
});

// Подача объявления
bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));

// Кнопка «Канал с объявлениями»
bot.hears('Канал с объявлениями', ctx =>
  ctx.reply(
    'Сюда 👇',
    Markup.inlineKeyboard([
      [ Markup.button.url('Перейти в канал', process.env.CHANNEL_URL) ]
    ])
  )
);

// Кнопка «Помощь»
bot.hears('Помощь', ctx =>
  ctx.reply('По всем вопросам обращайтесь к администратору: @max12kolt')
);

// Вывод собственных объявлений
bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('У вас пока нет опубликованных объявлений.');

  for (const ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo')    await ctx.telegram.sendPhoto   (ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    if (ad.mediaType === 'video')    await ctx.telegram.sendVideo   (ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    if (!ad.mediaType)               await ctx.replyWithHTML(cap);
  }
});

// === Функция и хендлеры для «Объявления в моём городе» + фильтрация ===

async function sendCityAds(ctx, categoryFilter = null) {
  const user = await UserModel.findOne({ userId: ctx.chat.id });
  if (!user || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('⚠️ Укажите местоположение через /setlocation, например: Россия Москва');
  }

  const countryQ = user.location.country.toLowerCase();
  const cityQ    = user.location.city   .toLowerCase();
  const offset   = ctx.session.cityAdOffset || 0;
  const allAds   = await AdModel.find({}).sort({ createdAt: -1 });

  const filtered = allAds.filter(ad =>
    ad.location.country.toLowerCase() === countryQ &&
    ad.location.city   .toLowerCase() === cityQ &&
    (!categoryFilter || ad.category === categoryFilter)
  );

  const page = filtered.slice(offset, offset + 5);
  if (!page.length) {
    ctx.session.cityAdOffset = 0;
    return ctx.reply('📭 Нет объявлений в вашем городе или категории.');
  }

  for (const ad of page) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo')    await ctx.telegram.sendPhoto   (ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    if (ad.mediaType === 'video')    await ctx.telegram.sendVideo   (ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    if (!ad.mediaType)               await ctx.replyWithHTML(cap);
  }

  ctx.session.cityAdOffset = offset + page.length;
  if (offset + page.length < filtered.length) {
    await ctx.reply(
      '⬇️ Показать ещё?',
      Markup.inlineKeyboard([
        [ Markup.button.callback('Показать ещё', 'more_city_ads') ]
      ])
    );
  } else {
    ctx.session.cityAdOffset = 0;
  }
}

bot.hears('Объявления в моём городе', ctx => sendCityAds(ctx));
bot.hears('Фильтр по категории', ctx =>
  ctx.reply(
    'Выберите категорию для фильтрации:',
    Markup.inlineKeyboard(
      Object.entries(categoryMap).map(
        ([key,label]) => Markup.button.callback(label, `filter_${key}`)
      ),
      { columns: 2 }
    )
  )
);
bot.action('more_city_ads', ctx => sendCityAds(ctx));
bot.action(/filter_(.+)/, ctx => sendCityAds(ctx, ctx.match[1]));

bot.catch(err => console.error('❌ Ошибка:', err));

const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  await bot.telegram.setWebhook(WEBHOOK_URL);
});
