require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const Message = require('./models/Message');

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
});

// ===================================================
// Middleware
// ===================================================
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===================================================
// Multer config (avatars + chat uploads)
// ===================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  },
});
const chatUpload = multer({ storage: chatStorage });

// ===================================================
// MongoDB Connection
// ===================================================
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/chat_app', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ===================================================
// AUTH ROUTES
// ===================================================
app.post('/signup', upload.single('avatar'), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing)
      return res.status(400).json({ error: 'Username or email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const avatarPath = req.file
      ? `/uploads/${req.file.filename}`
      : '/uploads/default.png';

    const user = new User({
      username,
      email,
      password: hashed,
      avatar: avatarPath,
      online: false,
      lastSeen: new Date(),
    });

    await user.save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      username: user.username,
      avatar: user.avatar,
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!password || (!username && !email))
      return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne(email ? { email } : { username });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect password' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      username: user.username,
      avatar: user.avatar || '/uploads/default.png',
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- Auth middleware ---
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --- Get current user profile ---
app.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('username email avatar');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// --- Update avatar and/or password ---
app.put('/me', auth, upload.single('avatar'), async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.file) {
      user.avatar = `/uploads/${req.file.filename}`;
    }

    const { currentPassword, newPassword } = req.body || {};
    if (currentPassword || newPassword) {
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Provide currentPassword and newPassword' });
      }
      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();

    // notify clients (optional)
    io.emit('profileUpdated', { username: user.username, avatar: user.avatar });

    res.json({ username: user.username, email: user.email, avatar: user.avatar });
  } catch (e) {
    console.error('Update profile error:', e);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ===================================================
// CHAT FILE UPLOAD ROUTE
// ===================================================
app.post('/upload-message', chatUpload.single('file'), async (req, res) => {
  try {
    const { username, room } = req.body;
    if (!req.file || !username || !room)
      return res.status(400).json({ error: 'Missing file or metadata' });

    const user = await User.findOne({ username });
    const fileUrl = `/uploads/${req.file.filename}`;
    const msg = new Message({
      room,
      username,
      text: '',
      avatar: user?.avatar || '/uploads/default.png',
      file: fileUrl,
      fileName: req.file.originalname,
      readBy: [],
    });

    await msg.save();
    io.to(room).emit('receiveMessage', msg);

    res.json({ success: true, message: msg });
    console.log(`📎 File uploaded in [${room}] by ${username}: ${req.file.originalname}`);
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// ===================================================
// ROOMS & MESSAGES
// ===================================================
const knownRooms = new Set(['general']);

app.get('/rooms', async (req, res) => {
  try {
    const agg = await Message.aggregate([{ $group: { _id: '$room' } }]);
    const fromDb = agg.map((r) => r._id).filter(Boolean);
    fromDb.forEach((r) => knownRooms.add(r));
    res.json(Array.from(knownRooms.values()).sort());
  } catch {
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

app.get('/messages', async (req, res) => {
  try {
    const room = (req.query.room || 'general').trim();
    if (room) knownRooms.add(room);
    const messages = await Message.find({ room }).sort({ createdAt: 1 });
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ===================================================
// SOCKET.IO (Per-Room Online Tracking)
// ===================================================
const onlineUsers = new Map();

// ✅ Emit users currently connected to a specific room
function emitOnlineUsers(room) {
  const usersInRoom = Array.from(onlineUsers.values())
    .filter((u) => u.room === room)
    .map((u) => ({
      username: u.username,
      avatar: u.avatar || '/uploads/default.png',
      online: true,
      lastSeen: new Date(),
    }));
  io.to(room).emit('onlineUsers', usersInRoom);
}

io.on('connection', (socket) => {
  console.log('🟢 New client connected:', socket.id);

  // --- Join Room ---
  socket.on('joinRoom', async ({ username, room }) => {
    const chosenRoom = (room || 'general').trim();

    // ✅ Leave any previous rooms before joining the new one
    for (const joined of socket.rooms) {
      if (joined !== socket.id) {
        socket.leave(joined);
      }
    }

    socket.username = username;
    socket.room = chosenRoom;

    const user = await User.findOneAndUpdate(
      { username },
      { online: true },
      { new: true }
    );

    socket.join(chosenRoom);
    onlineUsers.set(socket.id, { username, room: chosenRoom, avatar: user?.avatar });
    knownRooms.add(chosenRoom);

    emitOnlineUsers(chosenRoom);
    console.log(`👤 ${username} joined room: ${chosenRoom}`);
  });

  // --- Typing Indicators ---
  socket.on('typing', ({ username, room }) => {
    socket.to(room).emit('typing', username);
  });

  socket.on('stopTyping', ({ room }) => {
    socket.to(room).emit('stopTyping');
  });

  // --- Sending Messages ---
  socket.on('sendMessage', async ({ username, text, room }) => {
    try {
      const user = await User.findOne({ username });
      const msg = new Message({
        room,
        username,
        text,
        avatar: user?.avatar || '/uploads/default.png',
        readBy: [],
      });
      await msg.save();

      io.to(room).emit('receiveMessage', msg);
      console.log(`💬 [${room}] ${username}: ${text}`);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  // --- Read Receipts ---
  socket.on('markAsRead', async ({ username, room }) => {
    try {
      const unread = await Message.find({ room, readBy: { $ne: username } });
      for (const m of unread) {
        m.readBy.push(username);
        await m.save();
      }
      const updated = await Message.find({ room }).sort({ createdAt: 1 });
      io.to(room).emit('messageRead', updated);
    } catch (err) {
      console.error('Error updating read receipts:', err);
    }
  });

  // --- Disconnect Handling ---
  socket.on('disconnect', async () => {
    const info = onlineUsers.get(socket.id);
    if (info?.username) {
      await User.findOneAndUpdate(
        { username: info.username },
        { online: false, lastSeen: new Date() }
      );
    }
    onlineUsers.delete(socket.id);
    if (info?.room) emitOnlineUsers(info.room);
    console.log('🔴 Disconnected:', socket.id);
  });
});

// ===================================================
// START SERVER
// ===================================================
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});








