require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
try { require('dns').setServers(['8.8.8.8', '8.8.4.4']); } catch (_) {}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const Message = require('./models/Message');

const PORT = process.env.CHAT_PORT || 3001;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

// Socket.IO real-time chat handler
io.on('connection', (socket) => {
  console.log('Chat Client connected to Chat Server on port', PORT, 'socket id:', socket.id);

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
          if (!memoryMessages[roomId]) memoryMessages[roomId] = [];
          const memObj = { _id: Date.now().toString(), roomId, sessionId, clientMessageId, senderRole, text, createdAt: new Date() };
          memoryMessages[roomId].push(memObj);
          msg = memObj;
        }
      }
    } catch (e) {
      console.error('Error saving chat message notice:', e.message);
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
          if (!memoryMessages[roomId]) memoryMessages[roomId] = [];
          const memObj = { _id: Date.now().toString(), roomId, sessionId, clientMessageId, senderRole, text, createdAt: new Date() };
          memoryMessages[roomId].push(memObj);
          msg = memObj;
        }
      }
    } catch (e) {
      console.error('Error saving chat message notice:', e.message);
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

  socket.on('typing', ({ roomId, senderRole }) => {
    socket.to(roomId).emit('chat:typing:start', { senderRole });
    socket.to(roomId).emit('typing', { senderRole });
  });

  socket.on('stop-typing', ({ roomId, senderRole }) => {
    socket.to(roomId).emit('chat:typing:stop', { senderRole });
    socket.to(roomId).emit('stop-typing', { senderRole });
  });

  // Call Signaling (Voice & Video Call)
  socket.on('call-offer',  ({ roomId, offer, callType }) => socket.to(roomId).emit('call-offer',  { offer, callType }));
  socket.on('call-answer', ({ roomId, answer })          => socket.to(roomId).emit('call-answer', { answer }));
  socket.on('call-ice',    ({ roomId, candidate })       => socket.to(roomId).emit('call-ice',    { candidate }));
  socket.on('call-ended',  ({ roomId })                  => socket.to(roomId).emit('call-ended',  { roomId }));

  socket.on('call-user', ({ userToCall, signalData, from, name, callType }) => {
    io.to(userToCall).emit('call-user', { signal: signalData, from, name, callType });
  });

  socket.on('answer-call', (data) => {
    io.to(data.to).emit('call-accepted', data.signal);
  });

  socket.on('reject-call', (data) => {
    io.to(data.to).emit('call-ended');
  });

  socket.on('end-call', (data) => {
    io.to(data.to).emit('call-ended');
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

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
