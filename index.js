require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./src/bot/adSubmissionScene');
const { UserModel, AdModel } = require('./src/bot/models');

const { BOT_TOKEN, MONGO_URI } = process.env;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ Не заданы BOT_TOKEN или MONGO_URI');
  process.exit(1);
}

// ===== Bot Setup =====
const bot = new Telegraf(BOT_TOKEN);
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(session());
bot.use(stage.middleware());

// ===== Middleware =====
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

// ===== Main Menu Keyboard =====
function mainMenu() {
  return Markup.keyboard([
    ['Подать объявление'],
    ['Объявления в моём городе', 'Фильтр по категории'],
    ['Канал с объявлениями', 'Помощь'],
    ['Мои объявления']
  ]).resize();
}

// ===== Handlers =====
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

// ===== Category Buttons & Pagination =====
bot.hears('Подать объявление', ctx => ctx.scene.enter('adSubmission'));
bot.hears('Объявления в моём городе', async ctx => { ctx.session.offset = 0; await sendCityAds(ctx); });
bot.hears('Фильтр по категории', ctx => {
  ctx.session.offset = 0;
  return ctx.reply('Выберите категорию:', Markup.inlineKeyboard([
    ['auto', 'tech', 'real_estate', 'clothing', 'other', 'pets'].map(key =>
      Markup.button.callback(key, `filter_${key}`)
    )
  ].map(row => row)));
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

// ===== Объявления пользователя =====
bot.hears('Мои объявления', async ctx => {
  const ads = await AdModel.find({ userId: ctx.chat.id }).sort({ createdAt: -1 });
  if (!ads.length) return ctx.reply('Нет ваших объявлений');
  for (const ad of ads) {
    const caption = `📂 <b>${ad.category}</b>\n📝 ${ad.description}`;
    await ctx.replyWithHTML(caption);
  }
});

// ===== Mongo Init Once =====
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

// ===== Cloud Functions Entry Point =====
module.exports.handler = async function(event, context) {
  try {
    console.log('📩 Handler вызван:', event.httpMethod, event.path);

    await connectMongo();

    const body = JSON.parse(event.body || '{}');

    if (!body.message && !body.callback_query) {
      console.log('❌ Не Telegram update');
      return { statusCode: 200, body: 'Not a Telegram update' };
    }

    await bot.handleUpdate(body);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Ошибка в Cloud Function handler:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
