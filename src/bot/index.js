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
// middleware ограничения ожидания локации
bot.use((ctx, next) => {
  if (ctx.session?.awaitingLocationInput) {
    const t = ctx.message?.text;
    const allow = ['/cancel','/start','/setlocation, Канал с объявлениями, Помощь'];
    if (allow.includes(t)) return next();
    if (t?.startsWith('/')) return ctx.reply('⚠️ Сначала введите локацию или /cancel');
    if (ctx.callbackQuery) return ctx.reply('⚠️ Сначала введите локацию или /cancel');
  }
  return next();
});

// сценa подачи объявления
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

// /start
bot.command('start', async ctx => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) {
    user = new UserModel({userId,adCount:0,hasSubscription:false,location:{country:'не указано',city:'не указано'}});
    await user.save();
  }
  if (!user.location || !user.location.city || user.location.city==='не указано') {
    ctx.session.awaitingLocationInput = true;
    return ctx.reply('📍 Введите локацию (страна город):', Markup.removeKeyboard());
  }
  ctx.session.awaitingLocationInput = false;
  return ctx.reply('🎉 Добро пожаловать! Используйте меню:', mainMenu());
});

// /setlocation
bot.command('setlocation', ctx => {
  ctx.session.awaitingLocationInput = true;
  return ctx.reply('📍 Введите локацию (страна город):', Markup.removeKeyboard());
});

// /cancel
bot.command('cancel', async ctx => {
  if (ctx.session.awaitingLocationInput) {
    ctx.session.awaitingLocationInput = false;
    await ctx.reply('❌ Отменено. Перезапускаем...');
    return ctx.scene.leave() || bot.handleUpdate({...ctx.update,message:{...ctx.message,text:'/start'}},ctx.telegram);
  }
});

// ввод локации
bot.on('text', async (ctx, next) => {
  if (ctx.session.awaitingLocationInput) {
    const raw = ctx.message.text.trim();
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    let country, city;
    if (parts.length===1) {country='не указано'; city=parts[0];}
    else {country=parts[0]; city=parts.slice(1).join(' ');}
    let user = await UserModel.findOne({ userId:ctx.chat.id });
    if (!user) user=new UserModel({userId:ctx.chat.id,adCount:0,hasSubscription:false,location:{country,city}});
    else user.location={country,city};
    await user.save();
    ctx.session.awaitingLocationInput=false;
    return ctx.reply(`✅ Локация: ${country}, ${city}`, mainMenu());
  }
  return next();
});

// Подать объявление
bot.hears('Подать объявление', ctx=>ctx.scene.enter('adSubmission'));

// Объявления в моём городе
bot.hears('Объявления в моём городе', async ctx=>{
  ctx.session.offset=0;
  await sendCityAds(ctx);
});

// Фильтр по категории
bot.hears('Фильтр по категории', ctx=>{
  ctx.session.offset=0;
  return ctx.reply('Выберите:', Markup.inlineKeyboard([
    [Markup.button.callback('🚗 Авто','filter_auto')],
    [Markup.button.callback('📱 Техника','filter_tech')],
    [Markup.button.callback('🏠 Недвижимость','filter_real_estate')],
    [Markup.button.callback('👗 Одежда/Обувь','filter_clothing')],
    [Markup.button.callback('📦 Прочее','filter_other')],
    [Markup.button.callback('🐾 Товары','filter_pets')]
  ]));
});


//  "Канал с объявлениями"
bot.hears('Канал с объявлениями', async (ctx) => {
  await ctx.reply(
    'Сюда 👇',
    Markup.inlineKeyboard([
      Markup.button.url('Перейти в канал', 'https://t.me/+SpQdiZHBoypiNDky')
    ])
  );
});

// Обработка кнопки "Помощь"
bot.hears('Помощь', async (ctx) => {
  await ctx.reply(
    'По всем вопросам обращайтесь к администратору:\n[Администратор: @max12kolt](https://t.me/max12kolt)',
    { parse_mode: 'MarkdownV2' }
  );
});

// callback фильтра
bot.action(/filter_(.+)/, async ctx=>{
  ctx.session.cat=ctx.match[1];ctx.session.offset=0;await ctx.answerCbQuery();await sendCityAds(ctx,ctx.session.cat);
});
bot.action('more',async ctx=>{ctx.session.offset+=5;await ctx.answerCbQuery();await sendCityAds(ctx,ctx.session.cat);});

// Мои объявления
bot.hears('Мои объявления', async ctx=>{
  const ads=await AdModel.find({userId:ctx.chat.id}).sort({createdAt:-1});
  if(!ads.length) return ctx.reply('Нет ваших объявлений');
  for(let ad of ads){
    const cap=`📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}`;
    if(ad.mediaType==='photo')await ctx.telegram.sendPhoto(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else if(ad.mediaType==='video')await ctx.telegram.sendVideo(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else if(ad.mediaType==='document')await ctx.telegram.sendDocument(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});
    else ctx.replyWithHTML(cap);
  }
});

// функция sendCityAds
async function sendCityAds(ctx, cat=null){
  const user=await UserModel.findOne({userId:ctx.chat.id});
  if(!user||user.location.city==='не указано') return ctx.reply('⚠️ /setlocation: Россия Москва');
  const qCity=user.location.city.toLowerCase(),qCountry=user.location.country.toLowerCase();
  const all=await AdModel.find({}).sort({createdAt:-1});let res=[];
  for(let ad of all){const u=await UserModel.findOne({userId:ad.userId});if(!u)continue;const c=u.location.city.toLowerCase(),C=u.location.country.toLowerCase();let ok=false;if(qCity&&c.includes(qCity))ok=true;else if(qCountry&&C.includes(qCountry))ok=true;else if(!qCity&&!qCountry)ok=true;if(ok&&(!cat||ad.category===cat))res.push(ad);if(res.length>=ctx.session.offset+5)break;}
  if(!res.length)return ctx.reply(`🔍 Нет в ${user.location.city||user.location.country}`);
  const page=res.slice(ctx.session.offset,ctx.session.offset+5);
  for(let ad of page){const u=await UserModel.findOne({userId:ad.userId});const loc=`${u.location.country}, ${u.location.city}`;const cap=`📂 <b>${categoryMap[ad.category]}</b>\n📝 ${ad.description}\n📍 ${loc}`;if(ad.mediaType==='photo')await ctx.telegram.sendPhoto(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});else if(ad.mediaType==='video')await ctx.telegram.sendVideo(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});else if(ad.mediaType==='document')await ctx.telegram.sendDocument(ctx.chat.id,ad.mediaFileId,{caption:cap,parse_mode:'HTML'});else ctx.replyWithHTML(cap);}
  if(res.length>ctx.session.offset+5) await ctx.reply('⬇️ Ещё?',Markup.inlineKeyboard([Markup.button.callback('Ещё','more')]));
}

bot.catch(err=>console.error(err));
const app=express();app.use(bot.webhookCallback('/'));app.listen(PORT,async()=>{console.log('✅ Запущено');await bot.telegram.setWebhook(WEBHOOK_URL);});
