require('dotenv').config();

const express = require('express');
const {Telegraf, Markup, Scenes, session} = require('telegraf');
const mongoose = require('mongoose');
const adSubmissionScene = require('./adSubmissionScene');
const {UserModel, AdModel} = require('./models');

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
mongoose.connect(MONGO_URI, {useNewUrlParser: true, useUnifiedTopology: true})
  .then(() => console.log('✅ База данных подключена!'))
  .catch(err => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

// === Вспомогательная функция: главное меню ===
function mainKeyboard() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ])
    .resize();
}

// === Команда /start ===
bot.command('start', async ctx => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({userId});
  if (!user) {
    user = new UserModel({
      userId,
      adCount: 0,
      hasSubscription: false,
      location: {country: 'не указано', city: 'не указано'}
    });
    await user.save();
  }
  // Если локация не задана — просим ввод и убираем клавиатуру
  if (!user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('📍 Пожалуйста, укажите местоположение (Страна Город):', Markup.removeKeyboard());
  }
  // Иначе показываем главное меню
  ctx.session.awaitingLocationInput = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню для управления:', mainKeyboard());
});

// === Команда /setlocation ===
bot.command('setlocation', async ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply('📍 Пожалуйста, укажите местоположение (Страна Город):', Markup.removeKeyboard());
});

// === Обработчик текстовых сообщений ===
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // прочие команды
    // разделяем по запятой, точке, пробелу
    const parts = text.split(/[\s,\.]+/).filter(Boolean);
    let country = 'не указано';
    let city = 'не указано';
    if (parts.length === 1) {
      // только одно слово — считаем городом
      city = parts[0];
    } else {
      // минимум 2 части: первые — страна, остальные — город
      country = parts[0];
      city = parts.slice(1).join(' ');
    }
    const user = await UserModel.findOne({userId: ctx.chat.id});
    user.location = {country, city};
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
    return ctx.reply('⚠️ Сначала укажите страну и город, например: Россия Москва');
  }
  return next();
});

// === Основные хендлеры ===
bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Канал с объявлениями', ctx => ctx.reply('Сюда 👇', Markup.inlineKeyboard([
  Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
])));
bot.hears('Помощь', ctx => ctx.reply('По всем вопросам обращайтесь к администратору: @max12kolt'));
bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({userId: ctx.chat.id}).sort({createdAt: -1});
  if (!ads.length) return ctx.reply('У вас пока нет опубликованных объявлений.');
  for (const ad of ads) {
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else if (ad.mediaType === 'video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else await ctx.replyWithHTML(cap);
  }
});

bot.hears('Объявления в моём городе', async ctx => {
  ctx.session.cityAdOffset = 0;
  await sendCityAds(ctx);
});

bot.hears('Фильтр по категории', ctx => {
  ctx.session.cityAdOffset = 0;
  return ctx.reply('Выберите категорию:', Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Авто', 'filter_auto')],
    [Markup.button.callback('📱 Техника', 'filter_tech')],
    [Markup.button.callback('🏠 Недвижимость', 'filter_real_estate')],
    [Markup.button.callback('👗 Одежда/Обувь', 'filter_clothing')],
    [Markup.button.callback('📦 Прочее', 'filter_other')],
    [Markup.button.callback('🐾 Товары для животных', 'filter_pets')]
  ]));
});

bot.action(/filter_(.+)/, async ctx => {
  const categoryFilter = ctx.match[1];
  ctx.session.selectedCategory = categoryFilter;
  ctx.session.cityAdOffset = 0;
  await ctx.answerCbQuery();
  await sendFiltered(ctx, categoryFilter);
});

bot.action('more_city_ads', async ctx => {
  ctx.session.cityAdOffset = (ctx.session.cityAdOffset || 0) + 5;
  await ctx.answerCbQuery();
  await sendCityAds(ctx, ctx.session.selectedCategory);
});

// === Функции для выдачи объявлений ===
async function sendFiltered(ctx, categoryFilter) {
  const ads = await AdModel.find({category: categoryFilter}).sort({createdAt: -1}).skip(0).limit(5);
  if (!ads.length) {
    return ctx.reply(`🔍 Объявлений в категории "${categoryMap[categoryFilter]}" пока нет.`);
  }
  for (const ad of ads) {
    const u = await UserModel.findOne({userId: ad.userId});
    const loc = u?.location || {country: 'не указано', city: 'не указано'};
    const cap = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}\n📍 ${loc.country}, ${loc.city}`;
    if (ad.mediaType === 'photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else if (ad.mediaType === 'video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else await ctx.replyWithHTML(cap);
  }
  if (ads.length === 5) {
    await ctx.reply('⬇️ Показать ещё?', Markup.inlineKeyboard([
      Markup.button.callback('Показать ещё', 'more_city_ads')
    ]));
  }
}

async function sendCityAds(ctx, categoryFilter = null) {
  const user = await UserModel.findOne({userId: ctx.chat.id});
  if (!user || !user.location || !user.location.city || user.location.city === 'не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('⚠️ Укажите местоположение через /setlocation, например: Россия Москва');
  }
  const cityQuery = user.location.city.toLowerCase();
  const countryQuery = user.location.country.toLowerCase();
  const offset = ctx.session.cityAdOffset || 0;
  const allAds = await AdModel.find({}).sort({createdAt: -1});

  // Фильтрация по подстроке
  let filtered = [];
  for (const ad of allAds) {
    const u = await UserModel.findOne({userId: ad.userId});
    if (!u || !u.location) continue;
    const city = (u.location.city || '').toLowerCase();
    const country = (u.location.country || '').toLowerCase();
    // если указан город, ищем по городу
    if (cityQuery && cityQuery !== 'не указано') {
      if (city.includes(cityQuery) && (!categoryFilter || ad.category === categoryFilter)) filtered.push(ad);
    } else if (countryQuery && countryQuery !== 'не указано') {
      // иначе ищем только по стране
      if (country.includes(countryQuery) && (!categoryFilter || ad.category === categoryFilter)) filtered.push(ad);
    } else {
      if (!categoryFilter || ad.category === categoryFilter) filtered.push(ad);
    }
    if (filtered.length >= offset + 5) break;
  }

  if (filtered.length === 0) {
    const locLabel = cityQuery && cityQuery !== 'не указано' ? cityQuery : countryQuery;
    return ctx.reply(`🔍 Объявлений в указанной локации "${locLabel}" не найдено. Попробуйте изменить локацию.`);
  }

  const page = filtered.slice(offset, offset + 5);
  for (const ad of page) {
    const u = await UserModel.findOne({userId: ad.userId});
    const loc = u?.location || {country: 'не указано', city: 'не указано'};
    const cap = `📂 <b>${categoryMap[ad.category]}</b>
       📝 ${ad.description}
       📍 ${loc.country}, ${loc.city}`;
    if (ad.mediaType === 'photo') await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else if (ad.mediaType === 'video') await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else if (ad.mediaType === 'document') await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, {
      caption: cap,
      parse_mode: 'HTML'
    });
    else await ctx.replyWithHTML(cap);
  }

  if (page.length + offset < filtered.length) {
    await ctx.reply('⬇️ Показать ещё?', Markup.inlineKeyboard([
      Markup.button.callback('Показать ещё', 'more_city_ads')
    ]));
  }
}

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
