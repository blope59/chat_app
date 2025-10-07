require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const User = require('./models/User');
const Message = require('./models/Message');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

// --- MIDDLEWARE ---
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// --- DB CONNECT ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// --- AUTH ROUTES ---
app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: "Username already exists" });

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(400).json({ error: "Email already in use" });

    const hashedPw = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPw });
    await user.save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const query = username.includes("@") ? { email: username } : { username };
    const user = await User.findOne(query);

    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// --- MESSAGE ROUTES ---
app.get("/messages", async (req, res) => {
  try {
    const messages = await Message.find({ room: "global" }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// --- SOCKET.IO ---
let onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);

  // --- JOIN ROOM ---
  socket.on("joinRoom", ({ username }) => {
    const room = "global";
    socket.username = username;
    socket.join(room);
    onlineUsers.set(socket.id, { username, room });

    io.to(room).emit(
      "onlineUsers",
      Array.from(onlineUsers.values()).map(u => u.username)
    );

    console.log(`👤 ${username} joined room: ${room}`);
  });

  // --- TYPING EVENTS ---
  socket.on("typing", (username) => {
    socket.to("global").emit("typing", username);
  });

  socket.on("stopTyping", () => {
    socket.to("global").emit("stopTyping");
  });

  // --- SEND MESSAGE ---
  socket.on("sendMessage", async ({ username, text }) => {
    try {
      const message = new Message({
        room: "global",
        username,
        text,
        readBy: [], // ✅ sender does NOT auto-read their own message
      });

      await message.save();

      // Broadcast to everyone (sender sees gray check)
      io.to("global").emit("receiveMessage", message);
      console.log(`💬 ${username}: ${text}`);
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  // --- MARK AS READ ---
  socket.on("markAsRead", async ({ username }) => {
    try {
      const room = "global";

      // Find all unread messages in this room
      const unreadMessages = await Message.find({
        room,
        readBy: { $ne: username },
      });

      if (unreadMessages.length > 0) {
        await Promise.all(
          unreadMessages.map(async (msg) => {
            msg.readBy.push(username);
            await msg.save();
          })
        );

        // Fetch updated messages
        const updatedMessages = await Message.find({ room }).sort({ createdAt: 1 });

        // Broadcast updated messages to everyone in the room
        io.to(room).emit("messageRead", updatedMessages);
        
        console.log(`📬 ${username} marked ${unreadMessages.length} messages as read`);
      }
    } catch (err) {
      console.error("❌ Error updating read receipts:", err);
    }
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
    onlineUsers.delete(socket.id);
    io.to("global").emit(
      "onlineUsers",
      Array.from(onlineUsers.values()).map(u => u.username)
    );
  });
});

// --- START SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

