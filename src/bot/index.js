require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { categoryMap } = require('./utils');
const adSubmissionScene = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN || !MONGO_URI || !WEBHOOK_URL) {
  console.error('❌ Не заданы BOT_TOKEN, MONGO_URI или WEBHOOK_URL');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB error:', err);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

// Блокируем только /setlocation внутри сцены adSubmission
bot.use((ctx, next) => {
  if (
    ctx.scene.current?.id === 'adSubmission' &&
    ctx.updateType === 'message' &&
    ctx.message.text === '/setlocation'
  ) {
    return ctx.reply('❗ Чтобы изменить локацию — завершите подачу /cancel.');
  }
  return next();
});

function mainKeyboard() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления'],
  ]).resize();
}

bot.command('start', async ctx => {
  if (ctx.scene.current) await ctx.scene.leave();
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({ userId, adCount: 0, hasSubscription: false, location: { country: 'не указано', city: 'не указано' } });
    await user.save();
  }
  if (!user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('📍 Укажите местоположение (Страна Город):', Markup.removeKeyboard());
  }
  ctx.session.awaitingLocationInput = false;
  return ctx.reply('🎉 Добро пожаловать!', mainKeyboard());
});

bot.command('setlocation', ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply('📍 Укажите местоположение (Страна Город):', Markup.removeKeyboard());
});

bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const t = ctx.message.text.trim();
    if (t.startsWith('/')) return;
    const parts = t.split(/\s+/);
    const [country, ...city] = parts;
    const user = await UserModel.findOne({ userId: ctx.chat.id });
    user.location = { country, city: city.join(' ') };
    await user.save();
    ctx.session.awaitingLocationInput = false;
    await ctx.reply(`✅ Сохранено: ${country}, ${city.join(' ')}`);
    return ctx.reply('🎉 Главное меню:', mainKeyboard());
  }
  return next();
});

bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Канал с объявлениями', ctx => ctx.reply('Сюда 👇', Markup.inlineKeyboard([Markup.button.url('Канал', process.env.CHANNEL_URL)])));
bot.hears('Помощь', ctx => ctx.reply('По вопросам: @admin'));
bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('Нет объявлений.');
  for (const ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else await ctx.replyWithHTML(cap);
  }
});

bot.catch(err => console.error(err));

const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT, async () => {
  console.log(`Listening on ${PORT}`);
  await bot.telegram.setWebhook(WEBHOOK_URL);
});