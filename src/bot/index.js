// === Загрузка переменных окружения ===
require('dotenv').config();

const express = require('express');
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./adSubmissionScene');
const { UserModel } = require('./models');

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = `https://boroxlo-bot-tg.onrender.com`;

// === Проверка конфигурации ===
if (!BOT_TOKEN || !MONGO_URI) {
  console.error('❌ BOT_TOKEN или MONGO_URI не установлены в .env');
  process.exit(1);
}

// === Подключение к MongoDB ===
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch((err) => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
    process.exit(1);
  });

// === Инициализация бота ===
const bot = new Telegraf(BOT_TOKEN);

// === Подключение сцен ===
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(session());
bot.use(stage.middleware());

// === Команда /start ===
bot.command('start', async (ctx) => {
  if (!ctx.session.welcomeMessageSent) {
    await ctx.reply(
      'Добро пожаловать! 🎉 Используйте меню для управления:',
      Markup.keyboard([
        ['Подать объявление'],
        ['Канал с объявлениями', 'Помощь'],
      ]).resize()
    );
    ctx.session.welcomeMessageSent = true;
  }
});

// === Обработка кнопки "Канал с объявлениями" ===
bot.hears('Канал с объявлениями', async (ctx) => {
  await ctx.reply(
    'Сюда 👇',
    Markup.inlineKeyboard([
      Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
    ])
  );
});

// === Обработка кнопки "Подать объявление" ===
bot.hears('Подать объявление', async (ctx) => {
  const userId = ctx.chat.id;

  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({ userId, adCount: 0, hasSubscription: false });
    await user.save();
  }

  return ctx.scene.enter('adSubmission');
});

// === Обработка кнопки "Помощь" ===
bot.hears('Помощь', async (ctx) => {
  await ctx.reply(
    'По всем вопросам обращайтесь к администратору:\n[Администратор: @max12kolt](https://t.me/max12kolt)',
    { parse_mode: 'MarkdownV2' }
  );
});

// === Обработка ошибок ===
bot.catch((err) => {
  console.error('❌ Ошибка в работе бота:', err.message);
});

// === Запуск сервера Express ===
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
