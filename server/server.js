require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
try { require('dns').setServers(['8.8.8.8', '8.8.4.4']); } catch (_) {}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const Message = require('./models/Message');
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let dbPromise = null;
function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!dbPromise) {
    dbPromise = connectDatabase().catch(err => {
      console.error('Database connection failed:', err.message);
      dbPromise = null;
    });
  }
  return dbPromise;
}

// DB readiness middleware for API routes
app.use('/api', async (req, res, next) => {
  await ensureDbConnected();
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Database is not connected. Please ensure MongoDB is running or configure MONGO_URI in .env.'
    });
  }
  next();
});

const journalRoutes = require('./routes/journal');
const aiRoutes = require('./routes/ai');
const bookingRoutes = require('./routes/booking');
const questRoutes = require('./routes/quests');
const { analyzeText } = require('./utils/nlpEngine');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/quests', questRoutes);

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Socket.IO real-time chat
io.on('connection', (socket) => {
  // Chat V2 Namespaced Handlers
  socket.on('chat:join', ({ roomId }) => {
    if (roomId) socket.join(roomId);
  });

  socket.on('chat:send', async ({ roomId, sessionId, clientMessageId, senderId, senderRole, text }, ack) => {
    let msg = null;
    try {
      if (clientMessageId && mongoose.connection.readyState === 1) {
        msg = await Message.findOne({ clientMessageId });
      }
      if (!msg) {
        const validSender = (senderId && mongoose.Types.ObjectId.isValid(senderId)) ? senderId : null;
        if (mongoose.connection.readyState === 1) {
          msg = await Message.create({ roomId, sessionId, clientMessageId, sender: validSender, senderRole, text });
        } else {
          msg = { _id: Date.now().toString(), roomId, sessionId, clientMessageId, senderRole, text, createdAt: new Date() };
        }
      }
    } catch (err) {
      console.error('Chat V2 message save notice:', err.message);
    }

    const payload = {
      _id: msg ? (msg._id ? msg._id.toString() : Date.now().toString()) : Date.now().toString(),
      clientMessageId: clientMessageId || (msg ? msg.clientMessageId : null),
      roomId,
      sessionId: sessionId || (msg ? msg.sessionId : null),
      text: msg ? msg.text : text,
      senderRole,
      senderId: msg ? msg.sender : senderId,
      createdAt: msg ? msg.createdAt : new Date()
    };

    io.to(roomId).emit('chat:message', payload);
    io.to(roomId).emit('receive-message', payload);

    if (typeof ack === 'function') {
      ack({ success: true, message: payload });
    }
  });

  socket.on('chat:typing:start', ({ roomId, senderRole }) => {
    socket.to(roomId).emit('chat:typing:start', { senderRole });
    socket.to(roomId).emit('typing', { senderRole });
  });

  socket.on('chat:typing:stop', ({ roomId, senderRole }) => {
    socket.to(roomId).emit('chat:typing:stop', { senderRole });
    socket.to(roomId).emit('stop-typing', { senderRole });
  });

  socket.on('chat:leave', (roomId) => {
    if (roomId) socket.leave(roomId);
  });

  // Legacy Socket.IO Event Handlers
  socket.on('join-room', (roomId) => {
    if (roomId) socket.join(roomId);
  });

  socket.on('send-message', async ({ roomId, sessionId, clientMessageId, senderId, senderRole, text }, ack) => {
    let msg = null;
    try {
      if (clientMessageId && mongoose.connection.readyState === 1) {
        msg = await Message.findOne({ clientMessageId });
      }
      if (!msg) {
        const validSender = (senderId && mongoose.Types.ObjectId.isValid(senderId)) ? senderId : null;
        if (mongoose.connection.readyState === 1) {
          msg = await Message.create({ roomId, sessionId, clientMessageId, sender: validSender, senderRole, text });
        } else {
          msg = { _id: Date.now().toString(), roomId, sessionId, clientMessageId, senderRole, text, createdAt: new Date() };
        }
      }
    } catch (err) {
      console.error('Message save notice:', err.message);
    }

    const payload = {
      _id: msg ? (msg._id ? msg._id.toString() : Date.now().toString()) : Date.now().toString(),
      clientMessageId: clientMessageId || (msg ? msg.clientMessageId : null),
      roomId,
      sessionId: sessionId || (msg ? msg.sessionId : null),
      text: msg ? msg.text : text,
      senderRole,
      createdAt: msg ? msg.createdAt : new Date()
    };

    io.to(roomId).emit('chat:message', payload);
    io.to(roomId).emit('receive-message', payload);

    if (typeof ack === 'function') {
      ack({ success: true, message: payload });
    }
  });

  socket.on('trigger-crisis', ({ roomId, crisisLevel, triggers }) => {
    io.to(roomId).emit('crisis-alert', { crisisLevel, triggers });
  });

  socket.on('typing', ({ roomId, senderRole }) => {
    socket.to(roomId).emit('chat:typing:start', { senderRole });
    socket.to(roomId).emit('typing', { senderRole });
  });

  socket.on('stop-typing', ({ roomId, senderRole }) => {
    socket.to(roomId).emit('chat:typing:stop', { senderRole });
    socket.to(roomId).emit('stop-typing', { senderRole });
  });

  socket.on('leave-room', (roomId) => {
    if (roomId) socket.leave(roomId);
  });

  // WebRTC call signaling
  socket.on('call-offer',  ({ roomId, offer, callType }) => socket.to(roomId).emit('call-offer',  { offer, callType }));
  socket.on('call-answer', ({ roomId, answer })          => socket.to(roomId).emit('call-answer', { answer }));
  socket.on('call-ice',    ({ roomId, candidate })       => socket.to(roomId).emit('call-ice',    { candidate }));
  socket.on('call-ended',  ({ roomId })                  => socket.to(roomId).emit('call-ended'));
});

// Connect DB and start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

async function connectDatabase() {
  const customUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/carenexus';
  try {
    try { require('dns').setServers(['8.8.8.8', '8.8.4.4']); } catch (_) {}
    await mongoose.connect(customUri, { serverSelectionTimeoutMS: 4000 });
    console.log('MongoDB connected successfully via MONGO_URI');
  } catch (err) {
    console.warn('MongoDB Atlas connection attempt failed:', err.message);
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongoServer = await MongoMemoryServer.create({ binary: { version: '4.4.18' } });
      const uri = mongoServer.getUri();
      await mongoose.connect(uri);
      console.log(`In-memory MongoDB connected successfully at ${uri}`);
    } catch (e) {
      console.warn('Database connection fallback notice:', e.message);
    }
  }
  await seedDefaultMentors();
}

async function seedDefaultMentors() {
  try {
    const User = require('./models/User');
    const mentorCount = await User.countDocuments({ role: 'mentor' });
    if (mentorCount === 0) {
      await User.create([
        {
          username: 'Sarah_PeerGuide',
          email: 'sarah@carenexus.org',
          password: 'password123',
          role: 'mentor',
          bio: 'Passionate mental health advocate dedicated to creating a safe, non-judgmental sanctuary for emotional wellness and active guidance.',
          specialties: ['Anxiety & Stress', 'Mindfulness', 'Peer Guidance'],
          rating: 4.9,
          education: [
            { degree: 'B.S. in Counseling & Behavioral Psychology', institution: 'University of California', year: '2021' },
            { degree: 'Certified Peer Support Specialist (CPSS)', institution: 'National Association of Peer Supporters', year: '2022' }
          ],
          achievements: [
            { title: '500+ Hours Active Support', description: 'Awarded for over 500 hours of active peer counseling.', icon: 'workspace_premium' },
            { title: 'Top Listener Badge', description: 'Consistently rated 4.9/5 by community members.', icon: 'star' }
          ]
        },
        {
          username: 'David_Listener',
          email: 'david@carenexus.org',
          password: 'password123',
          role: 'mentor',
          bio: 'Empathetic listener specializing in burnout recovery, academic stress, and crisis grounding techniques.',
          specialties: ['Burnout & Fatigue', 'Academic & Life Pressure', 'Active Listening'],
          rating: 4.8,
          education: [
            { degree: 'M.A. in Clinical Social Work', institution: 'Columbia University', year: '2020' }
          ],
          achievements: [
            { title: 'Excellence in Mindfulness Coaching', description: 'Recognized for stress reduction workshops.', icon: 'military_tech' }
          ]
        }
      ]);
      console.log('Seeded default active mentors (Sarah_PeerGuide & David_Listener)');
    }
  } catch (err) {
    console.error('Seeding error:', err.message);
  }
}

connectDatabase();

module.exports = app;


