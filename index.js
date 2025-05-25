require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./src/bot/adSubmissionScene');
const { UserModel, AdModel } = require('./src/bot/models');

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных'
};

const { BOT_TOKEN, MONGO_URI } = process.env;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ Не заданы BOT_TOKEN или MONGO_URI');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(stage.middleware());

bot.use((ctx, next) => {
  if (ctx.session?.awaitingLocationInput) {
    const text = ctx.message?.text;
    if (['/cancel', '/start', '/setlocation'].includes(text)) return next();
    if (text?.startsWith('/')) return ctx.reply('⚠️ Сначала введите локацию или /cancel');
    if (ctx.callbackQuery) return ctx.reply('⚠️ Сначала введите локацию или /cancel');
  }
  return next();
});

bot.use(async (ctx, next) => {
  if (ctx.message?.text === '/cancel') {
    ctx.session.awaitingLocationInput = false;
    delete ctx.session.category;
    if (ctx.scene?.current) await ctx.scene.leave();
    return ctx.reply('❌ Отменено.');
  }
  return next();
});

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
    user = new UserModel({
      userId,
      adCount: 0,
      hasSubscription: false,
      location: { country: 'не указано', city: 'не указано' }
    });
    await user.save();
  }
  if (!user.location?.city || user.location.city === 'не указано') {
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

bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const raw = ctx.message.text.trim();
    const parts = raw.split(/[,\s]+/).filter(Boolean);
    const country = parts.length > 1 ? parts[0] : 'не указано';
    const city = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
    let user = await UserModel.findOne({ userId: ctx.chat.id });
    if (!user) {
      user = new UserModel({ userId: ctx.chat.id, adCount: 0, hasSubscription: false });
    }
    user.location = { country, city };
    await user.save();
    ctx.session.awaitingLocationInput = false;
    return ctx.reply(`✅ Локация: ${country}, ${city}`, mainMenu());
  }
  return next();
});

bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Объявления в моём городе', async ctx => { ctx.session.offset = 0; await sendCityAds(ctx); });
bot.hears('Фильтр по категории', ctx => {
  ctx.session.offset = 0;
  return ctx.reply('Выберите категорию:', Markup.inlineKeyboard([
    [Markup.button.callback(categoryMap.auto, 'filter_auto')],
    [Markup.button.callback(categoryMap.tech, 'filter_tech')],
    [Markup.button.callback(categoryMap.real_estate, 'filter_real_estate')],
    [Markup.button.callback(categoryMap.clothing, 'filter_clothing')],
    [Markup.button.callback(categoryMap.other, 'filter_other')],
    [Markup.button.callback(categoryMap.pets, 'filter_pets')]
  ]));
});
bot.hears('Канал с объявлениями', ctx =>
  ctx.reply('Сюда 👇', Markup.inlineKeyboard([
    Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
  ]))
);
bot.hears('Помощь', ctx =>
  ctx.reply('По всем вопросам обращайтесь к администратору:\n[Администратор: @max12kolt](https://t.me/max12kolt)', { parse_mode: 'MarkdownV2' })
);

bot.action(/filter_(.+)/, async ctx => {
  ctx.session.cat = ctx.match[1];
  ctx.session.offset = 0;
  await ctx.answerCbQuery();
  await sendCityAds(ctx, ctx.session.cat);
});
bot.action('more', async ctx => { ctx.session.offset += 5; await ctx.answerCbQuery(); await sendCityAds(ctx, ctx.session.cat); });

bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('Нет ваших объявлений');
  for (const ad of ads) {
    const caption = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    switch (ad.mediaType) {
      case 'photo': await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' }); break;
      case 'video': await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' }); break;
      case 'document': await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' }); break;
      default: await ctx.replyWithHTML(caption);
    }
  }
});

async function sendCityAds(ctx, cat = null) {
  const user = await UserModel.findOne({ userId: ctx.chat.id });
  if (!user || user.location.city === 'не указано') {
    return ctx.reply('⚠️ Установите локацию: /setlocation');
  }
  const { city: uCity, country: uCountry } = user.location;
  const qCity = uCity.toLowerCase();
  const qCountry = uCountry.toLowerCase();
  const allAds = await AdModel.find({}).sort({ createdAt: -1 });
  const filtered = [];
  for (const ad of allAds) {
    const adUser = await UserModel.findOne({ userId: ad.userId }); if (!adUser) continue;
    const cCity = adUser.location.city.toLowerCase();
    const cCountry = adUser.location.country.toLowerCase();
    let match = false;
    if ((qCity && cCity.includes(qCity)) || (qCountry && cCountry.includes(qCountry))) match = true;
    else if (!qCity && !qCountry) match = true;
    if (match && (!cat || ad.category === cat)) filtered.push(ad);
    if (filtered.length >= (ctx.session.offset || 0) + 5) break;
  }
  if (!filtered.length) return ctx.reply(`🔍 Нет объявлений в ${uCity}`);
  const page = filtered.slice(ctx.session.offset, ctx.session.offset + 5);
  for (const ad of page) {
    const adUser = await UserModel.findOne({ userId: ad.userId });
    const loc = `${adUser.location.country}, ${adUser.location.city}`;
    const caption = `📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}\n📍 ${loc}`;
    switch (ad.mediaType) {
      case 'photo': await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' }); break;
      case 'video': await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' }); break;
      case 'document': await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' }); break;
      default: await ctx.replyWithHTML(caption);
    }
  }
  if (filtered.length > (ctx.session.offset || 0) + 5) {
    await ctx.reply('⬇️ Ещё?', Markup.inlineKeyboard([Markup.button.callback('Ещё', 'more')]));
  }
}

bot.catch(err => console.error('❌ Bot error:', err));

// 🔁 Подключение к Mongo один раз
let mongoConnected = false;
async function connectMongo() {
  if (!mongoConnected) {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ MongoDB подключена');
    mongoConnected = true;
  }
}

// 📦 Экспорт обработчика для Yandex Cloud Functions
module.exports.handler = async function(event, context) {
  try {
    await connectMongo();

    const body = JSON.parse(event.body);

    if (!body || (!body.message && !body.callback_query)) {
      return { statusCode: 200, body: 'not a telegram update' };
    }

    await bot.handleUpdate(body);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Ошибка в handler:', err);
    return { statusCode: 500, body: 'internal error' };
  }
};
