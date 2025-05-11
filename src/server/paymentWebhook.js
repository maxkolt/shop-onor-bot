// const express = require('express');
// const bodyParser = require('body-parser');  // Для улучшенной обработки JSON
//
// function startPaymentServer(port, paymentHandler) {
//   const app = express();
//   app.use(bodyParser.json());  // Используем bodyParser для упрощенной работы с JSON
//
//   // Пример для добавления проверки подписи
//   const API_SECRET = 'test_MTAxMTY5NTlFn3M0vLGONDa0t9USIGWNWfs20O5zPmI';
//
//   app.post('/webhook/payment', async (req, res) => {
//     const receivedSignature = req.headers['x-signature']; // Подпись из хедеров
//     const expectedSignature = generateSignature(req.body, API_SECRET); // Функция для генерации подписи
//
//     if (receivedSignature !== expectedSignature) {
//       return res.status(403).send({ success: false, message: 'Подпись не совпадает' });
//     }
//
//     const { paymentId, status } = req.body;
//     if (!paymentId || !status) {
//       return res.status(400).send({ success: false, message: 'Неверный формат данных' });
//     }
//
//     try {
//       const paymentData = req.body;
//       console.log('Уведомление о платеже:', paymentData);
//       await paymentHandler(paymentData);
//       res.status(200).send({ success: true, message: 'Платёж успешно обработан' });
//     } catch (error) {
//       console.error('Ошибка обработки платежа:', error.message);
//       res.status(500).send({ success: false, message: 'Ошибка при обработке платежа' });
//     }
//   });
//
//   app.listen(port, () => {
//     console.log(`Сервер оплаты запущен на порту ${port}`);
//   });
// }
//
// // Функция для генерации подписи
// function generateSignature(body, secret) {
//   // Реализуйте алгоритм для генерации подписи по требованиям платёжной системы
//   return someHashFunction(body, secret);
// }
//
// module.exports = { startPaymentServer };
