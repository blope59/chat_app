const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  room: { type: String, default: 'global' },
  username: { type: String, required: true },
  text: { type: String, required: true },
  avatar: { type: String, default: '/uploads/default.png' }, // ✅ Added avatar field
  createdAt: { type: Date, default: Date.now },
  readBy: { type: [String], default: [] },
});

module.exports = mongoose.model('Message', MessageSchema);

