const { Scenes, Markup } = require('telegraf');
const { UserModel, AdModel } = require('./models');
const { categoryMap, generateCaption } = require('./utils');

const CHANNEL_ID = process.env.CHANNEL_ID;
const scene = new Scenes.BaseScene('adSubmission');

// команды
scene.command('cancel', ctx => ctx.reply('🚫 Отменено') && ctx.scene.leave());
scene.command(['start','setlocation'], ctx => ctx.reply('❗ /cancel чтобы выйти'));

scene.enter(async ctx => {
  const userId = ctx.chat.id;
  let user = await UserModel.findOne({ userId });
  if (!user) { user = new UserModel({ userId, adCount:0, hasSubscription:false, location:{country:'не указано',city:'не указано'} }); await user.save(); }
  await ctx.reply('Выберите категорию:', Markup.inlineKeyboard(Object.entries(categoryMap).map(([k,v])=>Markup.button.callback(v,`cat_${k}`)),{columns:1}));
});

scene.action(/cat_(.+)/, async ctx => {
  ctx.session.category = ctx.match[1];
  await ctx.reply(`Категория: ${categoryMap[ctx.session.category]}. Введите описание:`);
});

scene.on(['text','photo','video','document'], async ctx => {
  if (ctx.message.text?.startsWith('/')) return ctx.reply('❗ /cancel чтобы выйти');
  const userId = ctx.chat.id; const cat = ctx.session.category; const user = await UserModel.findOne({ userId });
  let desc = '';
  let mediaType, mediaFileId;
  if (ctx.message.text) { desc = ctx.message.text; }
  else if (ctx.message.photo) { mediaType='photo'; mediaFileId = ctx.message.photo.pop().file_id; desc = ctx.message.caption||''; }
  else if (ctx.message.video) { mediaType='video'; mediaFileId=ctx.message.video.file_id; desc = ctx.message.caption||''; }
  else if (ctx.message.document) { mediaType='document'; mediaFileId=ctx.message.document.file_id; desc = ctx.message.caption||''; }
  const ad = new AdModel({ userId, category:cat, description:desc, mediaType, mediaFileId, createdAt:new Date(), location:user.location });
  await ad.save(); user.adCount++; await user.save();
  const post = generateCaption(user.location,cat,desc);
  if(mediaType==='photo') await ctx.telegram.sendPhoto(CHANNEL_ID,mediaFileId,{caption:post,parse_mode:'HTML'});
  else if(mediaType==='video') await ctx.telegram.sendVideo(CHANNEL_ID,mediaFileId,{caption:post,parse_mode:'HTML'});
  else if(mediaType==='document') await ctx.telegram.sendDocument(CHANNEL_ID,mediaFileId,{caption:post,parse_mode:'HTML'});
  else await ctx.telegram.sendMessage(CHANNEL_ID,post,{parse_mode:'HTML'});
  await ctx.reply('✅ Добавлено'); return ctx.scene.leave();
});

module.exports = scene;