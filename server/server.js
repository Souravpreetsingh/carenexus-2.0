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
const io = new Server(server, {
  cors: {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});
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

const setupSocketIO = require('./socketHandler');
setupSocketIO(io);

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


