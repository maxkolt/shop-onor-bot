#!/bin/bash

BOT_TOKEN='7703511185:AAHjt8dRuP4uSPfzRXCgZGmYjek8Zwc0OmE'
MONGO_URI='mongodb+srv://12345kolt:11223355@test.ytbi01k.mongodb.net/?retryWrites=true&w=majority&appName=test'
FUNCTION_URL='https://functions.yandexcloud.net/d4e1eje8e7s44fs41uk4'

echo "📦 Архивируем проект (без node_modules)..."
zip -r bot-function.zip index.js package.json package-lock.json src > /dev/null

echo "📁 Распаковываем архив..."
rm -rf bot-source
unzip -o bot-function.zip -d bot-source > /dev/null

echo "🚀 Загружаем в Yandex Cloud Functions..."
yc serverless function version create \
  --function-name telegram-bot \
  --runtime nodejs18 \
  --entrypoint index.handler \
  --memory 256MB \
  --execution-timeout 30s \
  --source-path ./bot-source \
  --environment "BOT_TOKEN=${BOT_TOKEN}" \
  --environment "MONGO_URI=${MONGO_URI}"

echo "🔗 Обновляем Telegram webhook..."
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${FUNCTION_URL}"

echo "📡 Проверяем webhook..."
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"

echo -e "\n✅ Готово! Код загружен, webhook обновлён, бот готов принимать сообщения."
