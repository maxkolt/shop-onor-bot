require('dotenv').config();

const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { categoryMap } = require('./utils');
const adSubmissionScene = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN || !MONGO_URI || !WEBHOOK_URL) {
  console.error('❌ Не заданы BOT_TOKEN, MONGO_URI или WEBHOOK_URL');
  process.exit(1);
}

// Подключение к MongoDB
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch(err => {
    console.error('❌ Ошибка подключения:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Stage и сцена подачи объявления
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

// === Middleware: блокируем только /setlocation внутри сцены ===
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

// === Главное меню ===
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
  // выход из сцены, если в ней
  if (ctx.scene.current) {
    await ctx.scene.leave();
  }

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

  // проверка локации
  if (!user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply(
      '📍 Пожалуйста, укажите местоположение (Страна Город):',
      Markup.removeKeyboard()
    );
  }

  // если локация есть
  ctx.session.awaitingLocationInput = false;
  return ctx.reply(
    '🎉 Добро пожаловать! Используйте меню для управления:',
    mainKeyboard()
  );
});

// === Команда /setlocation ===
bot.command('setlocation', ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply(
    '📍 Пожалуйста, укажите местоположение (Страна Город):',
    Markup.removeKeyboard()
  );
});

// === Обработка ввода локации ===
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const parts = text.split(/[\s,\.]+/).filter(Boolean);
    let country = 'не указано';
    let city = 'не указано';
    if (parts.length === 1) city = parts[0];
    else { country = parts[0]; city = parts.slice(1).join(' '); }

    const user = await UserModel.findOne({ userId: ctx.chat.id });
    user.location = { country, city };
    await user.save();

    ctx.session.awaitingLocationInput = false;
    await ctx.reply(`✅ Локация сохранена: ${country}, ${city}`);
    return ctx.reply(
      '🎉 Добро пожаловать! Используйте меню для управления:',
      mainKeyboard()
    );
  }
  return next();
});

// === Блокировка остальных команд при ожидании локации ===
bot.use((ctx, next) => {
  if (ctx.session.awaitingLocationInput && ctx.updateType === 'message') {
    return ctx.reply('⚠️ Сначала укажите страну и город, например: Россия Москва');
  }
  return next();
});

// === Основные хендлеры ===
bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Канал с объявлениями', ctx =>
  ctx.reply(
    'Сюда 👇',
    Markup.inlineKeyboard([
      Markup.button.url('Перейти в канал', process.env.CHANNEL_URL)
    ])
  )
);
bot.hears('Помощь', ctx => ctx.reply('По вопросам обращайтесь к администратору: @max12kolt'));

bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('У вас пока нет опубликованных объявлений.');

  for (const ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo')
      await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'video')
      await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'document')
      await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else
      await ctx.replyWithHTML(cap);
  }
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
