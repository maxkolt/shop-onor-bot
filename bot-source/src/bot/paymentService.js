const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const API_URL = 'https://api.yookassa.ru/v3/payments';

class YookassaPaymentService {
  constructor(providerConfig) {
    this.token = providerConfig.secretKey;
    this.shopId = providerConfig.shopId;
  }

  createAuthHeader() {
    return `Basic ${Buffer.from(`${this.shopId}:${this.token}`).toString('base64')}`;
  }

  async createInvoice(amount, currency, description, userId) {
    const paymentInfo = {
      amount: {
        value: amount.toFixed(2), // Убедитесь, что значение имеет два знака после запятой
        currency: currency,
      },
      payment_method_data: {
        type: 'bank_card',
      },
      confirmation: {
        type: 'redirect',
        return_url: 'https://yourwebsite.com/payment-success', // Используйте HTTPS URL
      },
      capture: true,
      description,
      metadata: {
        userId,
      },
    };

    try {
      const result = await axios.post(API_URL, paymentInfo, {
        headers: {
          Authorization: this.createAuthHeader(),
          'Idempotence-Key': uuidv4(),
          'Content-Type': 'application/json',
        },
      });

      return {
        url: result.data.confirmation.confirmation_url, // Используйте confirmation_url из ответа API
        invoice: result.data,
      };
    } catch (error) {
      console.error('Ошибка при создании счёта:', error.response?.data || error.message);
      return null;
    }
  }

  async checkPaymentStatus(paymentId) {
    try {
      const result = await axios.get(`${API_URL}/${paymentId}`, {
        headers: {
          Authorization: this.createAuthHeader(),
          'Content-Type': 'application/json',
        },
      });

      return {
        isPaid: result.data.status === 'succeeded',
        invoice: result.data,
      };
    } catch (error) {
      console.error('Ошибка при проверке статуса оплаты:', error.response?.data || error.message);
      return { isPaid: false };
    }
  }
}

module.exports = YookassaPaymentService;
