require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных'
};

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

// Middleware ограничения
bot.use((ctx, next) => {
  if (ctx.session?.awaitingLocationInput) {
    const messageText = ctx.message?.text;
    const allowed = ['/cancel', '/start', '/setlocation'];

    if (allowed.includes(messageText)) return next();

    if (messageText?.startsWith('/')) {
      return ctx.reply('⚠️ Сначала введите локацию (страна и город), или /cancel для отмены.');
    }
    if (ctx.callbackQuery) {
      return ctx.reply('⚠️ Сначала введите локацию (страна и город), или /cancel для отмены.');
    }
  }
  return next();
});

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
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('📍 Введите локацию (страна и город):', Markup.removeKeyboard());
  }
  ctx.session.awaitingLocationInput = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню:', mainMenu());
});

bot.command('setlocation', ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply('📍 Введите локацию (страна и город):', Markup.removeKeyboard());
});

bot.command('cancel', async ctx => {
  if (ctx.session.awaitingLocationInput) {
    ctx.session.awaitingLocationInput = false;
    await ctx.reply('❌ Ожидание локации отменено. Перезапуск...');
    return bot.handleUpdate({
      ...ctx.update,
      message: { ...ctx.message, text: '/start' }
    }, ctx.telegram);
  }
});

bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) return ctx.reply('⚠️ Укажите и страну, и город, например: Россия Москва');
    const [country, ...rest] = parts;
    const city = rest.join(' ');

    let user = await UserModel.findOne({ userId: ctx.chat.id });
    if (!user) {
      user = new UserModel({ userId: ctx.chat.id, location: { country, city }, adCount: 0, hasSubscription: false });
    } else {
      user.location = { country, city };
    }
    await user.save();
    ctx.session.awaitingLocationInput = false;

    return ctx.reply(`✅ Локация установлена: ${country}, ${city}`, mainMenu());
  }
  return next();
});

bot.hears('Подать объявление', async (ctx) => {
  return ctx.scene.enter('adSubmission');
});

bot.hears('Канал с объявлениями', async (ctx) => {
  await ctx.reply('Сюда 👇', Markup.inlineKeyboard([
    Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
  ]));
});

bot.hears('Помощь', async (ctx) => {
  await ctx.reply('По всем вопросам обращайтесь к администратору:\n[Администратор: @max12kolt](https://t.me/max12kolt)', { parse_mode: 'MarkdownV2' });
});

bot.hears('Мои объявления', async (ctx) => {
  const userId = ctx.chat.id;
  const ads = await AdModel.find({ userId }).sort({ createdAt: -1 }).limit(5);
  if (!ads.length) return ctx.reply('У вас пока нет объявлений.');
  for (const ad of ads) {
    const caption = `📂 <b>${categoryMap[ad.category] || ad.category}</b>\n📝 ${ad.description}`;
    if (ad.mediaType === 'photo') {
      await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' });
    } else if (ad.mediaType === 'video') {
      await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' });
    } else if (ad.mediaType === 'document') {
      await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' });
    } else {
      await ctx.replyWithHTML(caption);
    }
  }
});

bot.catch(err => console.error('❌ Ошибка:', err));

const app = express();
app.use(bot.webhookCallback('/'));
app.listen(PORT, async () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log('📡 Webhook установлен');
  } catch (e) {
    console.error('❌ Ошибка установки webhook:', e.message);
  }
});
