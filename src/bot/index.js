require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Укажите в .env

if (!BOT_TOKEN || !MONGO_URI || !WEBHOOK_URL) {
  console.error('❌ Отсутствуют BOT_TOKEN, MONGO_URI или WEBHOOK_URL в .env');
  process.exit(1);
}

// Подключение к MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB подключена'))
  .catch(err => {
    console.error('❌ Ошибка подключения к MongoDB:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ========== Middleware для ожидания локации ==========
// Блокируем _только_ обычные текстовые сообщения (не команды), пока ждём локацию
bot.use((ctx, next) => {
  if (
    ctx.updateType === 'message' &&
    typeof ctx.message.text === 'string' &&
    !ctx.message.text.startsWith('/') && // не команда
    ctx.session.awaitingLocation         // ждём локацию
  ) {
    return ctx.reply('⚠️ Сначала введите локацию (страна и/или город)');
  }
  return next();
});

// Инициализация сцен
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

// Главное меню
function mainMenu() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ]).resize();
}

// === /start ===
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

  // Если локация не задана в базе — запрашиваем
  if (!user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocation = true;
    return ctx.reply('📍 Введите локацию (страна и/или город):', Markup.removeKeyboard());
  }

  // Локация уже есть — показываем меню
  ctx.session.awaitingLocation = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню:', mainMenu());
});

// === /setlocation ===
bot.command('setlocation', ctx => {
  ctx.session.awaitingLocation = true;
  return ctx.reply('📍 Введите локацию (страна и/или город):', Markup.removeKeyboard());
});

// Обработка вводимой локации (plain text)
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocation) {
    const txt = ctx.message.text.trim();
    if (txt.startsWith('/')) return; // пропускаем команды

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

// Обработчики меню
bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Канал с объявлениями', ctx => ctx.reply('Сюда 👇', Markup.inlineKeyboard([
  Markup.button.url('Перейти', 'https://t.me/+SpQdiZHBoypiNDky')
])));
bot.hears('Помощь', ctx => ctx.reply('Админ: @max12kolt'));
bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('Нет ваших объявлений');
  for (let ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    switch(ad.mediaType) {
      case 'photo': await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
      case 'video': await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
      case 'document': await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
      default: await ctx.replyWithHTML(cap);
    }
  }
});

bot.hears('Объявления в моём городе', async ctx => { ctx.session.offset = 0; await sendCity(ctx); });
bot.hears('Фильтр по категории', ctx => {
  ctx.session.offset = 0;
  return ctx.reply('Выберите:', Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Авто','filter_auto')],
    [Markup.button.callback('📱 Техника','filter_tech')],
    [Markup.button.callback('🏠 Недвижимость','filter_real_estate')],
    [Markup.button.callback('👗 Одежда/Обувь','filter_clothing')],
    [Markup.button.callback('📦 Прочее','filter_other')],
    [Markup.button.callback('🐾 Животные','filter_pets')]
  ]));
});

bot.action(/filter_(.+)/, async ctx => { ctx.session.category = ctx.match[1]; ctx.session.offset = 0; await ctx.answerCbQuery(); await sendCity(ctx, ctx.session.category); });
bot.action('more', async ctx => { ctx.session.offset +=5; await ctx.answerCbQuery(); await sendCity(ctx, ctx.session.category); });

async function sendCity(ctx, cat=null) {
  const user = await UserModel.findOne({ userId: ctx.chat.id });
  const { country, city } = user.location;
  const qCity = city.toLowerCase(), qCountry = country.toLowerCase();
  const ads = await AdModel.find({}).sort({createdAt:-1});
  let res=[];
  for (let ad of ads) {
    const u=await UserModel.findOne({userId:ad.userId}); if(!u) continue;
    const c=u.location.city.toLowerCase(), C=u.location.country.toLowerCase();
    let ok=false;
    if (qCity!=='не указано' && c.includes(qCity)) ok=true;
    else if (qCountry!=='не указано' && C.includes(qCountry)) ok=true;
    else if (!qCity && !qCountry) ok=true;
    if (ok && (!cat||ad.category===cat)) res.push(ad);
    if (res.length>=ctx.session.offset+5) break;
  }
  if (!res.length) return ctx.reply(`🔍 Нет объявлений в "${city||country}"`);
  const page=res.slice(ctx.session.offset, ctx.session.offset+5);
  for (let ad of page) {
    const u=await UserModel.findOne({userId:ad.userId}); const loc=`${u.location.country}, ${u.location.city}`;
    const cap=`📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}\n📍 ${loc}`;
    switch(ad.mediaType){
      case 'photo': await ctx.telegram.sendPhoto(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'}); break;
      case 'video': await ctx.telegram.sendVideo(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'}); break;
      case 'document': await ctx.telegram.sendDocument(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'}); break;
      default: await ctx.replyWithHTML(cap);
    }
  }
  if (res.length>ctx.session.offset+5) await ctx.reply('⬇️ Ещё?', Markup.inlineKeyboard([Markup.button.callback('Ещё','more')]));
}

bot.catch(err=>console.error(err));

const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT, async () => {
  console.log('Запущено');
  await bot.telegram.setWebhook(WEBHOOK_URL);
});
