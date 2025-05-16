// === Загрузка переменных окружения ===
require('dotenv').config();

const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const adSubmissionScene = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = 'https://boroxlo-bot-tg.onrender.com';

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ BOT_TOKEN или MONGO_URI не установлены в .env');
  process.exit(1);
}

// Подключение MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch(err => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(session());
bot.use(stage.middleware());

// === Команда /start ===
bot.command('start', async (ctx) => {
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

  if (!ctx.session.welcomeMessageSent) {
    await ctx.reply(
      'Добро пожаловать! 🎉 Используйте меню для управления:',
      Markup.keyboard([
        ['Подать объявление'],
        ['Объявления в моём городе', 'Фильтр по категории'],
        ['Канал с объявлениями', 'Помощь']
      ]).resize()
    );
    ctx.session.welcomeMessageSent = true;
  }

  if (user.location.city === 'не указано' || user.location.country === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    await ctx.reply('📍 Пожалуйста, введите местоположение (Страна и Город):');
  }
});

// === Команда /setlocation ===
bot.command('setlocation', async (ctx) => {
  ctx.session.awaitingLocationInput = true;
  await ctx.reply('📍 Пожалуйста, введите местоположение (Страна и Город):');
});

// === Обработчик текста для локации ===
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const parts = ctx.message.text.trim().split(/[\s,\n]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      return ctx.reply('⚠️ Укажите и страну, и город, например: Россия Москва');
    }
    // Если пользователь ввёл "город страна", попробуем угадать: если первый похож на город, меняем
    let [country, ...cityParts] = parts;
    let city = cityParts.join(' ');
    // Если город состоит из одного слова и country совпадает с известным городом? (упрощённо)
    // Здесь можно добавить проверку списка городов, но опустим
    const user = await UserModel.findOne({ userId: ctx.chat.id });
    if (user) {
      user.location = { country, city };
      await user.save();
      ctx.session.awaitingLocationInput = false;
      return ctx.reply(`✅ Локация сохранена: ${country}, ${city}`);
    }
    return ctx.reply('⚠️ Сначала используйте /start');
  }
  return next();
});

// === Другие кнопки ===
bot.hears('Канал с объявлениями', ctx =>
  ctx.reply('Сюда 👇', Markup.inlineKeyboard([
    Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
  ]))
);

bot.hears('Подать объявление', async (ctx) => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({ userId, adCount: 0, hasSubscription: false, location: { country:'не указано', city:'не указано' } });
    await user.save();
  }
  return ctx.scene.enter('adSubmission');
});

bot.hears('Помощь', ctx =>
  ctx.reply(
    'По всем вопросам обращайтесь к администратору:\n' +
    '[Администратор: @max12kolt](https://t.me/max12kolt)',
    { parse_mode: 'MarkdownV2' }
  )
);

// === Объявления в моём городе ===
bot.hears('Объявления в моём городе', async (ctx) => {
  ctx.session.cityAdOffset = 0;
  await sendCityAds(ctx);
});

// === Фильтр по категории (без учёта локации) ===
bot.hears('Фильтр по категории', ctx => {
  ctx.session.cityAdOffset = 0;
  return ctx.reply('Выберите категорию:', Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Авто','filter_auto')],
    [Markup.button.callback('📱 Техника','filter_tech')],
    [Markup.button.callback('🏠 Недвижимость','filter_real_estate')],
    [Markup.button.callback('👗 Одежда/Обувь','filter_clothing')],
    [Markup.button.callback('📦 Прочее','filter_other')],
    [Markup.button.callback('🐾 Товары для животных','filter_pets')]
  ]));
});

// === Callback'и фильтрации по категории ===
bot.action(/filter_(.+)/, async (ctx) => {
  const categoryFilter = ctx.match[1];
  ctx.session.selectedCategory = categoryFilter;
  ctx.session.cityAdOffset = 0;
  await ctx.answerCbQuery();
  // Выдача по категории
  const ads = await AdModel.find({ category: categoryFilter })
    .sort({ createdAt:-1 })
    .skip(0).limit(5);
  if (!ads.length) {
    return ctx.reply(`🔍 Объявлений в категории "${categoryMap[categoryFilter] || categoryFilter}" пока нет.`);
  }
  for (const ad of ads) {
    const u = await UserModel.findOne({ userId: ad.userId });
    const loc = u?.location || { country:'не указано', city:'не указано' };
    const cap = `📂 <b>${categoryMap[ad.category]||ad.category}</b>\n📝 ${ad.description}\n📍 ${loc.country}, ${loc.city}`;
    if (ad.mediaType==='photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else if(ad.mediaType==='video') await ctx.telegram.sendVideo(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else if(ad.mediaType==='document') await ctx.telegram.sendDocument(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else await ctx.replyWithHTML(cap);
  }
  if (ads.length===5) await ctx.reply('⬇️ Показать ещё?',Markup.inlineKeyboard([Markup.button.callback('Показать ещё','more_city_ads')]));
});

bot.action('more_city_ads', async (ctx) => {
  ctx.session.cityAdOffset = (ctx.session.cityAdOffset||0)+5;
  await ctx.answerCbQuery();
  await sendCityAds(ctx, ctx.session.selectedCategory);
});

// === sendCityAds с fallback по стране ===
async function sendCityAds(ctx, categoryFilter=null) {
  const user = await UserModel.findOne({ userId: ctx.chat.id });
  if (!user||!user.location||user.location.city==='не указано'||user.location.country==='не указано') {
    ctx.session.awaitingLocationInput=true;
    return ctx.reply('⚠️ Укажите местоположение через /setlocation, например: Россия Москва');
  }
  const city = user.location.city.toLowerCase();
  const country = user.location.country.toLowerCase();
  const offset = ctx.session.cityAdOffset||0;
  const adsAll = await AdModel.find({}).sort({createdAt:-1});

  // Фильтр по городу
  let filtered = [];
  for (const ad of adsAll) {
    const u = await UserModel.findOne({ userId: ad.userId });
    if (u?.location?.city.toLowerCase()===city && (!categoryFilter||ad.category===categoryFilter)) filtered.push(ad);
    if (filtered.length>=offset+5) break;
  }
  let page = filtered.slice(offset, offset+5);
  if (!page.length) {
    // Нет по городу — показываем сообщение и ищем по стране
    await ctx.reply(`🔍 В вашем городе "${user.location.city}" пока нет.`);
    // фильтр по стране
    filtered = [];
    for (const ad of adsAll) {
      const u = await UserModel.findOne({ userId: ad.userId });
      if (u?.location?.country.toLowerCase()===country && (!categoryFilter||ad.category===categoryFilter)) filtered.push(ad);
      if (filtered.length>=5) break;
    }
    if (!filtered.length) {
      return ctx.reply(`🔍 Объявлений в вашей стране "${user.location.country}" тоже нет.`);
    }
    await ctx.reply(`ℹ️ Возможно вас заинтересуют объявления в вашей стране "${user.location.country}":`);
    page = filtered;
  }

  // Отправка объявлений
  for (const ad of page) {
    const u = await UserModel.findOne({ userId: ad.userId });
    const loc = u?.location||{country:'не указано',city:'не указано'};
    const cap = `📂 <b>${categoryMap[ad.category]||ad.category}</b>\n📝 ${ad.description}\n📍 ${loc.country}, ${loc.city}`;
    if(ad.mediaType==='photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else if(ad.mediaType==='video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else if(ad.mediaType==='document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else await ctx.replyWithHTML(cap);
  }

  // Кнопка ещё
  if(page.length+offset<adsAll.length) {
    await ctx.reply('⬇️ Показать ещё?',Markup.inlineKeyboard([Markup.button.callback('Показать ещё','more_city_ads')]));
  }
}

bot.catch(err=>console.error('❌ Ошибка:',err));
const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT,async()=>{
  console.log(`Сервер запущен на порту ${PORT}`);
  try{await bot.telegram.setWebhook(WEBHOOK_URL);console.log('Webhook установлен');}catch(e){console.error('Ошибка webhook:',e.message);}
});
