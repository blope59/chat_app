const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  room: { type: String, default: "global" },
  username: { type: String, required: true },
  text: { type: String, default: "" },
  avatar: { type: String, default: "/uploads/default.png" },
  file: { type: String, default: "" }, // ✅ File URL
  fileName: { type: String, default: "" }, // ✅ Original filename
  createdAt: { type: Date, default: Date.now },
  readBy: { type: [String], default: [] },
});

module.exports = mongoose.model("Message", MessageSchema);


