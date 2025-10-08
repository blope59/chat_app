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
    methods: ['GET', 'POST'],
  },
});

// --- MIDDLEWARE ---
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// --- DB CONNECT ---
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB error:', err));

// ---- In-memory rooms registry (optional convenience) ----
const knownRooms = new Set(['general']);

// --- AUTH ROUTES ---
app.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(400).json({ error: 'Email already in use' });

    const hashedPw = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPw });
    await user.save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username: user.username });
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
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- ROOMS + MESSAGES ROUTES ---
app.get('/rooms', async (req, res) => {
  try {
    // Also derive rooms from messages so you don't lose them on restart
    const agg = await Message.aggregate([{ $group: { _id: '$room' } }]);
    const fromDb = agg.map((r) => r._id).filter(Boolean);
    fromDb.forEach((r) => knownRooms.add(r));
    if (!knownRooms.size) knownRooms.add('general');
    res.json(Array.from(knownRooms.values()).sort());
  } catch (err) {
    console.error('Failed to list rooms:', err);
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

app.get('/messages', async (req, res) => {
  try {
    const room = (req.query.room || 'general').trim();
    if (room) knownRooms.add(room);
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 1000);
    const messages = await Message.find({ room }).sort({ createdAt: 1 }).limit(limit);
    res.json(messages);
  } catch (err) {
    console.error('Failed to fetch messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// --- SOCKET.IO ---
/**
 * We track online users per socket, including their room.
 * onlineUsers: Map<socketId, { username, room }>
 */
const onlineUsers = new Map();

function emitOnlineUsers(room) {
  const users = Array.from(onlineUsers.values())
    .filter((u) => u.room === room)
    .map((u) => u.username);
  io.to(room).emit('onlineUsers', users);
}

io.on('connection', (socket) => {
  // JOIN ROOM
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

  // TYPING
  socket.on('typing', ({ username, room }) => {
    const r = (room || socket.room || 'general').trim();
    socket.to(r).emit('typing', username);
  });

  socket.on('stopTyping', ({ room }) => {
    const r = (room || socket.room || 'general').trim();
    socket.to(r).emit('stopTyping');
  });

  // SEND MESSAGE
  socket.on('sendMessage', async ({ username, text, room }) => {
    try {
      const r = (room || socket.room || 'general').trim();
      const message = new Message({
        room: r,
        username,
        text,
        readBy: [], // sender does NOT auto-read
      });
      await message.save();
      io.to(r).emit('receiveMessage', message);
      console.log(`💬 [${r}] ${username}: ${text}`);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  // MARK AS READ
  socket.on('markAsRead', async ({ username, room }) => {
    try {
      const r = (room || socket.room || 'general').trim();
      const unread = await Message.find({ room: r, readBy: { $ne: username } });
      if (unread.length) {
        await Promise.all(
          unread.map(async (msg) => {
            msg.readBy.push(username);
            await msg.save();
          })
        );
        // Send updated room messages so clients can patch readBy
        const updated = await Message.find({ room: r }).sort({ createdAt: 1 });
        io.to(r).emit('messageRead', updated);
        console.log(`📬 ${username} marked ${unread.length} as read in ${r}`);
      }
    } catch (err) {
      console.error('❌ Error updating read receipts:', err);
    }
  });

  // DISCONNECT
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


