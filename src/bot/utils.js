// Общие константы и функции для бота
const categoryMap = {
  auto: '🚗 Авто',
  tech: '📱 Техника',
  real_estate: '🏠 Недвижимость',
  clothing: '👗 Одежда/Обувь',
  other: '📦 Прочее',
  pets: '🐾 Товары для животных',
};

/**
 * Генерирует HTML-подпись для объявления
 * @param {{country:string, city:string}} location
 * @param {string} categoryKey
 * @param {string} description
 */
function generateCaption(location, categoryKey, description) {
  const now = new Date();
  const date = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const locLine = (location.country !== 'не указано')
    ? `\n📍 <b>Местоположение:</b> ${location.country}, ${location.city}`
    : '';
  return (
    `📢 <b>Новое объявление!</b>\n\n` +
    `📂 <b>Категория:</b> <i>${categoryMap[categoryKey]}</i>\n` +
    `📝 <b>Описание:</b> ${description}\n\n` +
    `📅 ${date}, ${time}` +
    locLine
  );
}

module.exports = { categoryMap, generateCaption };
