// === Загрузка переменных окружения ===
require('dotenv').config();

const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const  adSubmissionScene  = require('./adSubmissionScene');
const { UserModel, AdModel } = require('./models');

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = `https://boroxlo-bot-tg.onrender.com`;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ BOT_TOKEN или MONGO_URI не установлены в .env');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch((err) => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
    process.exit(1);
  });

const bot = new Telegraf(BOT_TOKEN);

const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(session());
bot.use(stage.middleware());

bot.command('start', async (ctx) => {
  if (!ctx.session.welcomeMessageSent) {
    await ctx.reply(
      'Добро пожаловать! 🎉 Используйте меню для управления:',
      Markup.keyboard([
        ['Подать объявление'],
        ['Объявления в моём городе', 'Фильтр по категории'],
        ['Канал с объявлениями', 'Помощь'],
      ]).resize()
    );
    ctx.session.welcomeMessageSent = true;
  }
});

bot.command('setlocation', async (ctx) => {
  ctx.session.awaitingLocationInput = true;
  await ctx.reply('📍 Введите ваше местоположение в формате: "Страна, Город"');
});

bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const [country, city] = ctx.message.text.split(',').map(s => s.trim());

    if (!country || !city) {
      return await ctx.reply('⚠️ Неверный формат. Пожалуйста, используйте: "Страна, Город"');
    }

    const userId = ctx.chat.id;
    const user = await UserModel.findOne({ userId });

    if (user) {
      user.location = { country, city };
      await user.save();

      ctx.session.awaitingLocationInput = false;
      return await ctx.reply(`✅ Местоположение обновлено: ${country}, ${city}`);
    } else {
      return await ctx.reply('⚠️ Пользователь не найден.');
    }
  }
  return next();
});

bot.hears('Канал с объявлениями', async (ctx) => {
  await ctx.reply(
    'Сюда 👇',
    Markup.inlineKeyboard([
      Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
    ])
  );
});

bot.hears('Подать объявление', async (ctx) => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({ userId, adCount: 0, hasSubscription: false });
    await user.save();
  }
  return ctx.scene.enter('adSubmission');
});

bot.hears('Помощь', async (ctx) => {
  await ctx.reply(
    'По всем вопросам обращайтесь к администратору:\n[Администратор: @max12kolt](https://t.me/max12kolt)',
    { parse_mode: 'MarkdownV2' }
  );
});

// === Обработка кнопки "Объявления в моём городе" ===
bot.hears('Объявления в моём городе', async (ctx) => {
  ctx.session.cityAdOffset = 0;
  return sendCityAds(ctx);
});

// === Кнопка "Фильтр по категории" ===
bot.hears('Фильтр по категории', async (ctx) => {
  ctx.session.cityAdOffset = 0;
  await ctx.reply('Выберите категорию:', Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Авто', 'filter_auto')],
    [Markup.button.callback('📱 Техника', 'filter_tech')],
    [Markup.button.callback('🏠 Недвижимость', 'filter_real_estate')],
    [Markup.button.callback('👗 Одежда/Обувь', 'filter_clothing')],
    [Markup.button.callback('📦 Прочее', 'filter_other')],
    [Markup.button.callback('🐾 Товары для животных', 'filter_pets')],
  ]));
});

bot.action(/filter_(.+)/, async (ctx) => {
  const selectedCategory = ctx.match[1];
  ctx.session.selectedCategory = selectedCategory;
  ctx.session.cityAdOffset = 0;
  await ctx.answerCbQuery();
  return sendCityAds(ctx, selectedCategory);
});

bot.action('more_city_ads', async (ctx) => {
  ctx.session.cityAdOffset = (ctx.session.cityAdOffset || 0) + 5;
  const category = ctx.session.selectedCategory || null;
  await ctx.answerCbQuery();
  await sendCityAds(ctx, category);
});

const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных',
};

const sendCityAds = async (ctx, categoryFilter = null) => {
  const userId = ctx.chat.id;
  const user = await UserModel.findOne({ userId });

  if (!user || !user.location || user.location.city === 'не указано') {
    return ctx.reply('⚠️ Вы ещё не указали местоположение. Используйте команду /setlocation');
  }

  const city = user.location.city;
  const offset = ctx.session.cityAdOffset || 0;
  const ads = await AdModel.find({}).sort({ createdAt: -1 });
  const matchingAds = [];

  for (const ad of ads) {
    const adUser = await UserModel.findOne({ userId: ad.userId });
    const sameCity = adUser?.location?.city?.toLowerCase() === city.toLowerCase();
    const sameCategory = !categoryFilter || ad.category === categoryFilter;
    if (sameCity && sameCategory) {
      matchingAds.push({ ad, location: adUser.location });
    }
  }

  const page = matchingAds.slice(offset, offset + 5);
  if (page.length === 0) {
    return ctx.reply(offset === 0
      ? `🔍 Объявлений в городе "${city}"${categoryFilter ? ` по категории ${categoryMap[categoryFilter]}` : ''} пока нет.`
      : `🔚 Больше объявлений нет.`);
  }

  for (const { ad, location } of page) {
    const caption = `📂 <b>${categoryMap[ad.category] || ad.category}</b>\n📝 ${ad.description}\n📍 ${location.country}, ${location.city}`;
    try {
      if (ad.mediaType === 'photo') {
        await ctx.telegram.sendPhoto(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' });
      } else if (ad.mediaType === 'video') {
        await ctx.telegram.sendVideo(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' });
      } else if (ad.mediaType === 'document') {
        await ctx.telegram.sendDocument(ctx.chat.id, ad.mediaFileId, { caption, parse_mode: 'HTML' });
      } else {
        await ctx.replyWithHTML(caption);
      }
    } catch (error) {
      console.error('❌ Ошибка при отправке объявления:', error.message);
    }
  }

  if (matchingAds.length > offset + 7) {
    await ctx.reply('⬇️ Показать ещё?', Markup.inlineKeyboard([
      Markup.button.callback('Показать ещё', 'more_city_ads')
    ]));
  }
};

bot.catch((err) => {
  console.error('❌ Ошибка в работе бота:', err.message);
});

const app = express();
app.use(bot.webhookCallback('/'));

app.listen(PORT, async () => {
  console.log(`🌐 HTTP сервер запущен на порту ${PORT}`);
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log(`✅ Webhook установлен: ${WEBHOOK_URL}`);
  } catch (err) {
    console.error('❌ Не удалось установить webhook:', err.message);
  }
});

module.exports = adSubmissionScene;
