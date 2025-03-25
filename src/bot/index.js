const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
// const YookassaPaymentService = require('./paymentService'); // отключено временно
const { adSubmissionScene } = require('./adSubmissionScene');
const { UserModel } = require('./models');

// === Конфигурация ===
const BOT_TOKEN = '7785639584:AAGWHt_VWdfFXS-tYfsDw0gOHmcyu2lolks';
const MONGO_URI = 'mongodb+srv://12345kolt:kolosok12M@cluster0.bxxiz.mongodb.net/mydatabase?retryWrites=true&w=majority&appName=Cluster0';

// === Подключение к MongoDB ===
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ База данных подключена!'))
  .catch((err) => {
    console.error('❌ Ошибка подключения к базе данных:', err.message);
    process.exit(1);
  });

// === Инициализация бота ===
const bot = new Telegraf(BOT_TOKEN);

bot.telegram.getMe()
  .then((botInfo) => console.log(`🤖 Бот подключён`))
  .catch((err) => {
    console.error('❌ Ошибка подключения к Telegram API:', err.message);
    process.exit(1);
  });

// === Подключаем сцены ===
const stage = new Scenes.Stage([adSubmissionScene]);
bot.use(session());
bot.use(stage.middleware());

// === Команды ===
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Добро пожаловать! Используйте меню для управления:',
    Markup.keyboard([
      ['Подать объявление'],
      ['Канал с объявлениями', 'Помощь'],
    ]).resize()
  );

  // Инлайн кнопка перехода в канал
  await ctx.reply(
    '📢',
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

  // Отключено временно — логика подписки
  /*
  if (!user.hasSubscription && user.adCount >= 3) {
    return ctx.reply(
      'Вы достигли лимита бесплатных объявлений. Чтобы продолжить, оформите подписку.',
      Markup.inlineKeyboard([[Markup.button.callback('Оформить подписку', 'subscribe')]])
    );
  }
  */

  return ctx.scene.enter('adSubmission');
});

/*
// === Подписка (временно отключено) ===
bot.hears('Подписка', async (ctx) => {
  const userId = ctx.chat.id;

  const invoice = await paymentService.createInvoice(139, 'RUB', 'Оплата подписки', userId);

  if (invoice) {
    await ctx.reply(
      'Оплатите подписку по ссылке:',
      Markup.inlineKeyboard([
        [Markup.button.url('Оплатить', invoice.url)],
        [Markup.button.callback('Я оплатил', 'check_payment')],
      ])
    );
  } else {
    await ctx.reply('Ошибка при создании счёта. Попробуйте позже.');
  }
});

bot.action('check_payment', async (ctx) => {
  const userId = ctx.chat.id;
  const user = await UserModel.findOne({ userId });

  if (!user) {
    return ctx.reply('Вы не зарегистрированы.');
  }

  const paymentStatus = await paymentService.checkPaymentStatus();

  if (paymentStatus.isPaid) {
    user.hasSubscription = true;
    await user.save();
    return ctx.reply('Оплата подтверждена! Подписка активна.');
  }

  return ctx.reply('Оплата не найдена или ещё не подтверждена.');
});
*/

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

// === Запуск бота ===
bot.launch()
  .then(() => console.log('✅ Бот запущен!'))
  .catch((err) => console.error('❌ Ошибка при запуске бота:', err.message));
