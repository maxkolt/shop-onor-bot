require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN || !MONGO_URI || !WEBHOOK_URL) {
  console.error('❌ BOT_TOKEN, MONGO_URI или WEBHOOK_URL не указаны в .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB подключена'))
  .catch(err => {
    console.error('❌ Ошибка подключения к MongoDB:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Middleware: блокируем команды и кнопки, пока ждём локацию (кроме /cancel)
bot.use((ctx, next) => {
  if (ctx.session.awaitingLocation) {
    const messageText = ctx.message?.text;
    const isCancelCommand = messageText && messageText.startsWith('/cancel');

    if (isCancelCommand) return next();

    if (messageText?.startsWith('/')) {
      return ctx.reply('⚠️ Сначала введите локацию (страна и/или город), или /cancel для отмены.');
    }
    if (ctx.callbackQuery) {
      return ctx.reply('⚠️ Сначала введите локацию (страна и/или город), или /cancel для отмены.');
    }
  }
  return next();
});

// Сцены
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

function mainMenu() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ]).resize();
}

// /start
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
  if (!user.location || !user.location.city || user.location.city.trim().toLowerCase() === 'не указано') {
    ctx.session.awaitingLocation = true;
    return ctx.reply('📍 Введите локацию (страна и/или город):', Markup.removeKeyboard());
  }

  ctx.session.awaitingLocation = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню:', mainMenu());
});

// /setlocation
bot.command('setlocation', ctx => {
  ctx.session.awaitingLocation = true;
  return ctx.reply('📍 Введите локацию (страна и/или город):', Markup.removeKeyboard());
});

// /cancel — сброс ожидания локации и переход в /start
bot.command('cancel', async ctx => {
  if (ctx.session.awaitingLocation) {
    ctx.session.awaitingLocation = false;
    await ctx.reply('❌ Ожидание локации отменено. Перезапускаем...');
    return bot.handleUpdate({
      ...ctx.update,
      message: { ...ctx.message, text: '/start' }
    }, ctx.telegram);
  }
});

// Ввод локации (если ждём)
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocation) {
    const txt = ctx.message.text.trim();
    if (txt.startsWith('/')) return;

    const parts = txt.split(/[.,\s]+/).filter(Boolean);
    const country = parts.length > 1 ? parts[0] : 'не указано';
    const city    = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];

    const user = await UserModel.findOne({ userId: ctx.chat.id });
    if (user) {
      user.location = { country, city };
      await user.save();
      ctx.session.awaitingLocation = false;
      await ctx.reply(`✅ Локация установлена: ${country}, ${city}`);
      return ctx.reply('🎉 Меню:', mainMenu());
    }
    return ctx.reply('⚠️ Сначала /start');
  }
  return next();
});

bot.catch(err => console.error('❌ Ошибка:', err));

const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT, async () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  await bot.telegram.setWebhook(WEBHOOK_URL);
});