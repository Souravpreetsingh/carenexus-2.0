require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
try { require('dns').setServers(['8.8.8.8', '8.8.4.4']); } catch (_) {}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const Message = require('./models/Message');

const allowedCorsOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  return callback(null, origin);
};

const PORT = process.env.CHAT_PORT || 3001;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedCorsOrigin,
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors({
  origin: allowedCorsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Connect to MongoDB Atlas / MONGO_URI for chat persistence
const customUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/carenexus';
try { require('dns').setServers(['8.8.8.8', '8.8.4.4']); } catch (_) {}
mongoose.connect(customUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Chat Server connected to MongoDB successfully'))
  .catch(err => console.warn('Chat Server MongoDB connection notice:', err.message));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Fallback memory message store if DB is disconnected
const memoryMessages = {};

const setupSocketIO = require('./socketHandler');
setupSocketIO(io);

// Endpoint to fetch message history for a room
app.get('/api/sessions/:roomId/messages', (req, res) => {
  const roomId = req.params.roomId;
  if (mongoose.connection.readyState === 1) {
    Message.find({ roomId }).sort({ createdAt: 1 })
      .then(messages => res.json({ messages }))
      .catch(err => res.json({ messages: memoryMessages[roomId] || [] }));
  } else {
    res.json({ messages: memoryMessages[roomId] || [] });
  }
});

// Endpoint to fetch room details for mentor briefing
app.get('/api/sessions/room/:roomId', (req, res) => {
  res.json({
    session: {
      roomId: req.params.roomId,
      moodTag: 'General Emotional Support',
      userFeelingsNote: 'Seeking empathetic peer listener in sanctuary chat.',
      aiGuidance: {
        suggestedApproach: 'Provide reflective validation, open-ended questions, and grounding support.'
      }
    }
  });
});

// Redirect root to chat.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chat.html'));
});

server.listen(PORT, () => {
  console.log(`\n✨ CareNexus Dedicated Chat Server running on http://localhost:${PORT}/chat.html ✨\n`);
});
