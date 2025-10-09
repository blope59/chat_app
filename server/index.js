require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');          // 🆕 for file uploads
const path = require('path');              // 🆕 for working with file paths
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
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
});

// --- Middleware ---
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// 🆕 Serve static uploads folder so React can access images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 🆕 Multer storage setup for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// --- Connect to MongoDB ---
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB error:', err));

// --- Auth Routes ---
app.post('/signup', upload.single('avatar'), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser)
      return res.status(400).json({ error: 'Username or email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const avatarPath = req.file ? `/uploads/${req.file.filename}` : '';

    const user = new User({ username, email, password: hashed, avatar: avatarPath });
    await user.save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username: user.username, avatar: user.avatar });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const query = username.includes('@') ? { email: username } : { username };
    const user = await User.findOne(query);

    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username: user.username, avatar: user.avatar });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// 🆕 Route to update avatar later (optional)
app.post('/upload-avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.file) {
      user.avatar = `/uploads/${req.file.filename}`;
      await user.save();
      res.json({ success: true, avatar: user.avatar });
    } else {
      res.status(400).json({ error: 'No file uploaded' });
    }
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// --- Messages + Rooms Routes (same as before) ---
const knownRooms = new Set(['general']);

app.get('/rooms', async (req, res) => {
  try {
    const agg = await Message.aggregate([{ $group: { _id: '$room' } }]);
    const fromDb = agg.map((r) => r._id).filter(Boolean);
    fromDb.forEach((r) => knownRooms.add(r));
    res.json(Array.from(knownRooms.values()).sort());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

app.get('/messages', async (req, res) => {
  try {
    const room = (req.query.room || 'general').trim();
    if (room) knownRooms.add(room);
    const messages = await Message.find({ room }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// --- SOCKET.IO ---
const onlineUsers = new Map();

function emitOnlineUsers(room) {
  const users = Array.from(onlineUsers.values())
    .filter((u) => u.room === room)
    .map((u) => u.username);
  io.to(room).emit('onlineUsers', users);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ username, room }) => {
    const chosenRoom = (room || 'general').trim();
    socket.username = username;
    socket.room = chosenRoom;
    socket.join(chosenRoom);
    onlineUsers.set(socket.id, { username, room: chosenRoom });
    knownRooms.add(chosenRoom);
    emitOnlineUsers(chosenRoom);
    console.log(`👤 ${username} joined room: ${chosenRoom}`);
  });

  socket.on('typing', ({ username, room }) => {
    socket.to(room).emit('typing', username);
  });

  socket.on('stopTyping', ({ room }) => {
    socket.to(room).emit('stopTyping');
  });

  socket.on('sendMessage', async ({ username, text, room }) => {
    try {
      const msg = new Message({ room, username, text, readBy: [] });
      await msg.save();
      io.to(room).emit('receiveMessage', msg);
      console.log(`💬 [${room}] ${username}: ${text}`);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('markAsRead', async ({ username, room }) => {
    try {
      const unread = await Message.find({ room, readBy: { $ne: username } });
      if (unread.length) {
        for (const m of unread) {
          m.readBy.push(username);
          await m.save();
        }
        const updated = await Message.find({ room }).sort({ createdAt: 1 });
        io.to(room).emit('messageRead', updated);
        console.log(`📬 ${username} marked ${unread.length} messages as read in ${room}`);
      }
    } catch (err) {
      console.error('❌ Error updating read receipts:', err);
    }
  });

  socket.on('disconnect', () => {
    const info = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    if (info?.room) emitOnlineUsers(info.room);
    console.log('🔴 Client disconnected:', socket.id);
  });
});

// --- START SERVER ---
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

