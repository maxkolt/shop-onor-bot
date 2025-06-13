require('dotenv').config();
const express = require('express');
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./src/bot/adSubmissionScene');
const { UserModel, AdModel } = require('./src/bot/models');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Пример: 'https://xxxx.eu.ngrok.io'
const PORT = process.env.PORT || 3000;

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных'
};

if (!BOT_TOKEN || !MONGO_URI || !WEBHOOK_URL) {
  console.error('❌ Не указаны BOT_TOKEN, MONGO_URI или WEBHOOK_URL в .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB подключена'))
  .catch(err => {
    console.error('❌ Ошибка подключения к MongoDB:', err);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(session());
bot.use(stage.middleware());

function mainMenu() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ]).resize();
}

bot.command('start', async ctx => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({ userId, adCount: 0, hasSubscription: false, location: { country: 'не указано', city: 'не указано' } });
    await user.save();
  }
  if (!user.location || !user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('📍 Введите локацию (страна город):', Markup.removeKeyboard());
  }
  ctx.session.awaitingLocationInput = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню:', mainMenu());
});

bot.command('setlocation', ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply('📍 Введите локацию (страна город):', Markup.removeKeyboard());
});

bot.command('cancel', async ctx => {
  ctx.session.awaitingLocationInput = false;
  await ctx.scene.leave();
  return ctx.reply('❌ Действие отменено.', mainMenu());
});

// обработка локации пользователя
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const raw = ctx.message.text.trim();
    const parts = raw.split(/\s|,+/).filter(Boolean);
    const country = parts.length > 1 ? parts[0] : 'не указано';
    const city = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
    let user = await UserModel.findOne({ userId: ctx.chat.id });
    if (!user) user = new UserModel({ userId: ctx.chat.id, adCount: 0, hasSubscription: false });
    user.location = { country, city };
    await user.save();
    ctx.session.awaitingLocationInput = false;
    return ctx.reply(`✅ Локация: ${country}, ${city}`, mainMenu());
  }
  return next();
});

bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));

bot.hears('Объявления в моём городе', async ctx => {
  ctx.session.offset = 0;
  await sendCityAds(ctx);
});

bot.hears('Фильтр по категории', ctx => {
  ctx.session.offset = 0;
  return ctx.reply('Выберите:', Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Авто', 'filter_auto')],
    [Markup.button.callback('📱 Техника', 'filter_tech')],
    [Markup.button.callback('🏠 Недвижимость', 'filter_real_estate')],
    [Markup.button.callback('👗 Одежда/Обувь', 'filter_clothing')],
    [Markup.button.callback('📦 Прочее', 'filter_other')],
    [Markup.button.callback('🐾 Товары', 'filter_pets')]
  ]));
});

bot.hears('Канал с объявлениями', ctx =>
  ctx.reply('Сюда 👇', Markup.inlineKeyboard([
    Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
  ]))
);

bot.hears('Помощь', ctx =>
  ctx.reply('По всем вопросам: @max12kolt')
);

bot.action(/filter_(.+)/, async ctx => {
  ctx.session.cat = ctx.match[1];
  ctx.session.offset = 0;
  await ctx.answerCbQuery();
  await sendCityAds(ctx, ctx.session.cat);
});

bot.action('more', async ctx => {
  ctx.session.offset += 5;
  await ctx.answerCbQuery();
  await sendCityAds(ctx, ctx.session.cat);
});

bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('Нет ваших объявлений');
  for (const ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else await ctx.replyWithHTML(cap);
  }
});

// функция для показа объявлений по фильтру и городу
async function sendCityAds(ctx, cat = null) {
  const user = await UserModel.findOne({ userId: ctx.chat.id });
  if (!user || user.location.city === 'не указано') return ctx.reply('⚠️ /setlocation: Россия Москва');
  const qCity = user.location.city.toLowerCase();
  const qCountry = user.location.country.toLowerCase();
  const all = await AdModel.find({}).sort({ createdAt: -1 });
  let res = [];
  for (const ad of all) {
    const u = await UserModel.findOne({ userId: ad.userId });
    if (!u) continue;
    const c = u.location.city.toLowerCase();
    const C = u.location.country.toLowerCase();
    let ok = false;
    if (qCity && c.includes(qCity)) ok = true;
    else if (qCountry && C.includes(qCountry)) ok = true;
    else if (!qCity && !qCountry) ok = true;
    if (ok && (!cat || ad.category === cat)) res.push(ad);
    if (res.length >= ctx.session.offset + 5) break;
  }
  if (!res.length) return ctx.reply(`🔍 Нет в ${user.location.city || user.location.country}`);
  const page = res.slice(ctx.session.offset, ctx.session.offset + 5);
  for (const ad of page) {
    const u = await UserModel.findOne({ userId: ad.userId });
    const loc = `${u.location.country}, ${u.location.city}`;
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}\n📍 ${loc}`;
    if (ad.mediaType === 'photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' });
    else await ctx.replyWithHTML(cap);
  }
  if (res.length > ctx.session.offset + 5) {
    await ctx.reply('⬇️ Ещё?', Markup.inlineKeyboard([
      Markup.button.callback('Ещё', 'more')
    ]));
  }
}

bot.catch(err => console.error('Ошибка:', err));

// Express-сервер для webhook
const app = express();
app.use(express.json());

// endpoint для telegram webhook
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// Запускаем сервер и регистрируем webhook
app.listen(PORT, async () => {
  await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`🤖 Webhook URL зарегистрирован: ${WEBHOOK_URL}/webhook`);
});
