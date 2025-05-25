require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { adSubmissionScene } = require('./src/bot/adSubmissionScene');
const { UserModel, AdModel } = require('./src/bot/models');
const restoreState = require('./src/bot/restoreState');

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
  console.error('❌ BOT_TOKEN или MONGO_URI не заданы');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
bot.use(restoreState);
bot.use(new Scenes.Stage([adSubmissionScene]).middleware());

// Здесь идут все команды и обработчики — можно оставить как есть у тебя

// Подключение к MongoDB один раз
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

// Экспортируем обработчик для Yandex Cloud Functions
module.exports.handler = async function(event, context) {
  try {
    console.log('🔥 Запрос от Telegram:', event);
    await connectMongo();

    const body = JSON.parse(event.body || '{}');

    if (!body.message && !body.callback_query) {
      console.log('⚠️ Не Telegram update');
      return { statusCode: 200, body: 'not a telegram update' };
    }

    await bot.handleUpdate(body);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Ошибка в handler:', err);
    return { statusCode: 500, body: 'internal error' };
  }
};
