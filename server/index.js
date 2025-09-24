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
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// --- AUTH ROUTES ---

app.post("/signup", async (req, res) => {
  try {
    console.log("Signup received:", req.body); // Debugging line

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: "Email already in use" });
    }

    const hashedPw = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPw });
    await user.save();

    // sign JWT
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });

    res.json({ token, username: user.username });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

// --- Login Route ---
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if they typed an email (contains "@")
    const query = username.includes("@")
      ? { email: username }
      : { username: username };

    const user = await User.findOne(query);

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// --- MESSAGE ROUTES ---
app.get("/messages/:room?", async (req, res) => {
  try {
    const room = req.params.room || "global";
    const messages = await Message.find({ room }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// --- SOCKET.IO ---
io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);

  socket.on("sendMessage", async (data) => {
    try {
      const { room = "global", username, text } = data;

      // Save to DB
      const message = new Message({ room, username, text });
      await message.save();

      // Broadcast to all clients
      io.emit("receiveMessage", message);
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

// --- START SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

