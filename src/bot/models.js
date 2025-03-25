const mongoose = require('mongoose');

// Модель пользователя
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  adCount: { type: Number, default: 0 },
  hasSubscription: { type: Boolean, default: false },
});

// Модель объявления
const AdSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  mediaType: { type: String, enum: ['photo', 'video', 'document', 'none'], default: 'none' }, // тип медиа
  mediaFileId: { type: String }, // file_id от Telegram
  createdAt: { type: Date, default: Date.now },
});

const UserModel = mongoose.model('User', UserSchema);
const AdModel = mongoose.model('Ad', AdSchema);

module.exports = { UserModel, AdModel };
