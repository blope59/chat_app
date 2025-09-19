require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const Message = require('./models/Message');

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] }
});

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB error:', err));

app.get('/messages', async (req, res) => {
  const room = req.query.room || 'global';
  const limit = parseInt(req.query.limit) || 100;
  try {
    const messages = await Message.find({ room })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('joinRoom', ({ username, room }) => {
    room = room || 'global';
    socket.join(room);
    socket.data.username = username;
    socket.data.room = room;

    if (!onlineUsers[room]) onlineUsers[room] = {};
    onlineUsers[room][socket.id] = username;

    io.to(room).emit('onlineUsers', Object.values(onlineUsers[room]));
    io.to(room).emit('receiveMessage', {
      system: true,
      text: `${username} joined ${room}`,
      createdAt: new Date(),
    });
  });

  socket.on('sendMessage', async ({ text, room }) => {
    const username = socket.data.username || 'Anonymous';
    room = room || socket.data.room || 'global';
    const msg = new Message({ username, text, room });
    try {
      await msg.save();
      io.to(room).emit('receiveMessage', {
        _id: msg._id,
        username: msg.username,
        text: msg.text,
        createdAt: msg.createdAt,
        room: msg.room,
      });
    } catch (err) {
      console.error('msg save error', err);
    }
  });

  socket.on('typing', ({ isTyping }) => {
    const username = socket.data.username || 'Anonymous';
    const room = socket.data.room || 'global';
    socket.to(room).emit('typing', { username, isTyping });
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (room && onlineUsers[room]) {
      delete onlineUsers[room][socket.id];
      io.to(room).emit('onlineUsers', Object.values(onlineUsers[room]));
      io.to(room).emit('receiveMessage', {
        system: true,
        text: `${username || 'A user'} left ${room}`,
        createdAt: new Date(),
      });
      if (Object.keys(onlineUsers[room]).length === 0) {
        delete onlineUsers[room];
      }
    }
    console.log('Socket disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
