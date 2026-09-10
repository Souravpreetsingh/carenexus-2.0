const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Message = require('./models/Message');
const Session = require('./models/Session');
const JWT_SECRET = process.env.JWT_SECRET || 'carenexus_jwt_secret_key_2026';

function setupSocketIO(io) {
  // Socket Authentication Middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.userId = null;
        socket.userRole = null;
        return next();
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id || decoded._id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      console.warn('[CHAT-V2] Socket auth warning:', err.message);
      socket.userId = null;
      socket.userRole = null;
      next();
    }
  });

  io.on('connection', (socket) => {
    console.log(`[CHAT-V2] socket connected: ${socket.id} authenticated_user: ${socket.userId || 'anonymous'} role: ${socket.userRole || 'none'}`);

    // Helper: Authenticate socket if token supplied in event payload
    function authenticateSocketToken(token) {
      if (socket.userId && socket.userRole) {
        return { userId: socket.userId, userRole: socket.userRole };
      }
      if (!token) return null;
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.id || decoded._id;
        socket.userRole = decoded.role;
        return { userId: socket.userId, userRole: socket.userRole };
      } catch (err) {
        return null;
      }
    }

    // ─── 1. JOIN ROOM ──────────────────────────────────────────────────────────
    socket.on('chat:join', async ({ sessionId, roomId, token }, ack) => {
      console.log(`[CHAT-V2] join requested: roomId=${roomId} sessionId=${sessionId} socket=${socket.id}`);
      
      const authState = authenticateSocketToken(token);
      if (!authState) {
        console.warn(`[CHAT-V2] join rejected - unauthenticated socket: ${socket.id}`);
        if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED' });
        return;
      }

      try {
        let session = null;
        if (mongoose.connection.readyState === 1) {
          if (sessionId) {
            session = await Session.findById(sessionId);
          } else if (roomId) {
            session = await Session.findOne({ roomId });
          }
        }

        const targetRoomId = roomId || (session ? session.roomId : null);
        if (!targetRoomId) {
          if (typeof ack === 'function') ack({ success: false, error: 'ROOM_NOT_FOUND' });
          return;
        }

        // Verify session participation if DB is active
        if (session) {
          const isUser = session.user.toString() === authState.userId;
          const isMentor = session.mentor && session.mentor.toString() === authState.userId;
          const isMentorRole = authState.userRole === 'mentor';
          if (!isUser && !isMentor && !isMentorRole) {
            console.warn(`[CHAT-V2] join rejected - user ${authState.userId} not a participant in session ${session._id}`);
            if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED_PARTICIPANT' });
            return;
          }
        }

        socket.join(targetRoomId);
        const roomSockets = io.sockets.adapter.rooms.get(targetRoomId);
        const membersCount = roomSockets ? roomSockets.size : 1;

        console.log(`[CHAT-V2] room joined: ${targetRoomId} socket=${socket.id} user=${authState.userId} membersCount=${membersCount}`);

        if (typeof ack === 'function') {
          ack({
            success: true,
            sessionId: session ? session._id.toString() : sessionId,
            roomId: targetRoomId,
            membersCount
          });
        }
      } catch (err) {
        console.error(`[CHAT-V2] join error:`, err.message);
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    // ─── 2. SEND MESSAGE ───────────────────────────────────────────────────────
    socket.on('chat:send', async ({ sessionId, roomId, clientMessageId, text, replyToMessageId, token }, ack) => {
      console.log(`[CHAT-V2] send received: clientMessageId=${clientMessageId} roomId=${roomId} replyToMessageId=${replyToMessageId} socket=${socket.id}`);

      const authState = authenticateSocketToken(token);
      if (!authState) {
        console.warn(`[CHAT-V2] send rejected - unauthenticated socket: ${socket.id}`);
        if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED' });
        return;
      }

      if (!roomId || !text) {
        if (typeof ack === 'function') ack({ success: false, error: 'INVALID_PAYLOAD' });
        return;
      }

      try {
        let session = null;
        if (mongoose.connection.readyState === 1) {
          if (sessionId) {
            session = await Session.findById(sessionId);
          } else if (roomId) {
            session = await Session.findOne({ roomId });
          }
        }

        // Verify session participation and active status
        if (session) {
          const isUser = session.user.toString() === authState.userId;
          const isMentor = session.mentor && session.mentor.toString() === authState.userId;
          const isMentorRole = authState.userRole === 'mentor';
          if (!isUser && !isMentor && !isMentorRole) {
            console.warn(`[CHAT-V2] send rejected - user ${authState.userId} not authorized for room ${roomId}`);
            if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED_PARTICIPANT' });
            return;
          }

          if (session.status !== 'active') {
            console.warn(`[CHAT-V2] send rejected - session ${session._id} status is '${session.status}' (read-only)`);
            if (typeof ack === 'function') ack({ success: false, error: 'READ_ONLY_SESSION', message: 'This session has ended and is read-only.' });
            socket.emit('chat:error', { error: 'READ_ONLY_SESSION', message: 'This session has ended and is read-only.' });
            return;
          }
        }

        // Validate reply target if replyToMessageId provided
        let targetReplyMsg = null;
        if (replyToMessageId && mongoose.connection.readyState === 1) {
          if (!mongoose.Types.ObjectId.isValid(replyToMessageId)) {
            if (typeof ack === 'function') ack({ success: false, error: 'INVALID_REPLY_TARGET', message: 'Invalid reply message ID format.' });
            return;
          }
          targetReplyMsg = await Message.findById(replyToMessageId);
          if (!targetReplyMsg || targetReplyMsg.isDeleted) {
            if (typeof ack === 'function') ack({ success: false, error: 'INVALID_REPLY_TARGET', message: 'Original message not found or deleted.' });
            return;
          }

          // Verify original message belongs to the exact same session and room
          const targetSessionId = targetReplyMsg.sessionId ? targetReplyMsg.sessionId.toString() : null;
          const currentSessionId = session ? session._id.toString() : sessionId;
          if (targetReplyMsg.roomId !== roomId && (targetSessionId && currentSessionId && targetSessionId !== currentSessionId)) {
            console.warn(`[CHAT-V2] Cross-session reply attempt rejected: targetSession=${targetSessionId} currentSession=${currentSessionId}`);
            if (typeof ack === 'function') ack({ success: false, error: 'INVALID_REPLY_TARGET', message: 'Cross-session reply is forbidden.' });
            return;
          }
        }

        // Idempotency check using clientMessageId
        let msg = null;
        if (clientMessageId && mongoose.connection.readyState === 1) {
          msg = await Message.findOne({ clientMessageId });
        }

        if (!msg) {
          const validSender = (authState.userId && mongoose.Types.ObjectId.isValid(authState.userId)) ? authState.userId : null;
          if (mongoose.connection.readyState === 1) {
            msg = await Message.create({
              roomId,
              sessionId: session ? session._id.toString() : sessionId,
              clientMessageId,
              sender: validSender,
              senderRole: authState.userRole,
              text,
              replyToMessageId: targetReplyMsg ? targetReplyMsg._id : null
            });
          } else {
            msg = {
              _id: Date.now().toString(),
              roomId,
              sessionId: session ? session._id.toString() : sessionId,
              clientMessageId,
              sender: validSender,
              senderRole: authState.userRole,
              text,
              replyToMessageId: targetReplyMsg ? targetReplyMsg._id : null,
              createdAt: new Date()
            };
          }
        }

        let replyToPreview = null;
        if (targetReplyMsg || (msg && msg.replyToMessageId)) {
          const rMsg = targetReplyMsg || (await Message.findById(msg.replyToMessageId));
          if (rMsg) {
            replyToPreview = {
              messageId: rMsg._id.toString(),
              senderRole: rMsg.senderRole,
              senderId: rMsg.sender ? rMsg.sender.toString() : null,
              text: rMsg.isDeleted ? 'This message was deleted' : rMsg.text,
              createdAt: rMsg.createdAt
            };
          }
        }

        const canonicalMessage = {
          _id: msg._id ? msg._id.toString() : Date.now().toString(),
          clientMessageId: clientMessageId || (msg.clientMessageId || null),
          roomId,
          sessionId: sessionId || (msg.sessionId ? msg.sessionId.toString() : null),
          senderId: authState.userId,
          senderRole: authState.userRole,
          text: msg.text || text,
          replyToMessageId: msg.replyToMessageId ? msg.replyToMessageId.toString() : null,
          replyTo: replyToPreview,
          reactions: msg.reactions || [],
          isEdited: msg.isEdited || false,
          isDeleted: msg.isDeleted || false,
          createdAt: msg.createdAt || new Date(),
          status: 'sent'
        };

        const roomSockets = io.sockets.adapter.rooms.get(roomId);
        const membersCount = roomSockets ? roomSockets.size : 0;

        console.log(`[CHAT-V2] broadcasting to room: ${roomId} membersCount=${membersCount} sender=${authState.userId} messageId=${canonicalMessage._id}`);

        // Broadcast to all participants in the room (including sender & recipient)
        io.to(roomId).emit('chat:message', canonicalMessage);
        io.to(roomId).emit('receive-message', canonicalMessage);

        console.log(`[CHAT-V2] broadcast complete for message: ${canonicalMessage._id}`);

        if (typeof ack === 'function') {
          ack({ success: true, message: canonicalMessage });
        }
      } catch (err) {
        console.error(`[CHAT-V2] send error:`, err.message);
        if (typeof ack === 'function') ack({ success: false, error: err.message });
        socket.emit('chat:error', { error: err.message });
      }
    });

    // ─── 3. TYPING INDICATORS ─────────────────────────────────────────────────
    socket.on('chat:typing:start', ({ roomId }) => {
      if (roomId) {
        socket.to(roomId).emit('chat:typing:start', { senderRole: socket.userRole || 'user' });
        socket.to(roomId).emit('typing', { senderRole: socket.userRole || 'user' });
      }
    });

    socket.on('chat:typing:stop', ({ roomId }) => {
      if (roomId) {
        socket.to(roomId).emit('chat:typing:stop', { senderRole: socket.userRole || 'user' });
        socket.to(roomId).emit('stop-typing', { senderRole: socket.userRole || 'user' });
      }
    });

    socket.on('chat:leave', (roomId) => {
      if (roomId) {
        socket.leave(roomId);
        console.log(`[CHAT-V2] left room: ${roomId} socket=${socket.id}`);
      }
    });

    // ─── 3.5. EDIT, DELETE, REACTION & READ RECEIPTS ─────────────────────────
    socket.on('chat:message:edit', async ({ messageId, text, token }, ack) => {
      const authState = authenticateSocketToken(token);
      if (!authState) {
        if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED' });
        return;
      }
      if (!messageId || !text || !text.trim()) {
        if (typeof ack === 'function') ack({ success: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      try {
        const msg = await Message.findById(messageId);
        if (!msg) {
          if (typeof ack === 'function') ack({ success: false, error: 'NOT_FOUND' });
          return;
        }
        if (msg.sender && msg.sender.toString() !== authState.userId) {
          if (typeof ack === 'function') ack({ success: false, error: 'FORBIDDEN' });
          return;
        }
        const session = await Session.findOne({ roomId: msg.roomId });
        if (session && session.status !== 'active') {
          if (typeof ack === 'function') ack({ success: false, error: 'READ_ONLY_SESSION' });
          return;
        }

        msg.text = text.trim();
        msg.isEdited = true;
        msg.editedAt = new Date();
        await msg.save();

        const updatePayload = {
          messageId: msg._id.toString(),
          roomId: msg.roomId,
          text: msg.text,
          isEdited: true,
          editedAt: msg.editedAt
        };

        io.to(msg.roomId).emit('chat:message:edit', updatePayload);
        if (typeof ack === 'function') ack({ success: true, message: updatePayload });
      } catch (err) {
        console.error('[CHAT-V2] edit error:', err.message);
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    socket.on('chat:message:delete', async ({ messageId, token }, ack) => {
      const authState = authenticateSocketToken(token);
      if (!authState) {
        if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED' });
        return;
      }
      if (!messageId) {
        if (typeof ack === 'function') ack({ success: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      try {
        const msg = await Message.findById(messageId);
        if (!msg) {
          if (typeof ack === 'function') ack({ success: false, error: 'NOT_FOUND' });
          return;
        }
        if (msg.sender && msg.sender.toString() !== authState.userId) {
          if (typeof ack === 'function') ack({ success: false, error: 'FORBIDDEN' });
          return;
        }
        const session = await Session.findOne({ roomId: msg.roomId });
        if (session && session.status !== 'active') {
          if (typeof ack === 'function') ack({ success: false, error: 'READ_ONLY_SESSION' });
          return;
        }

        msg.isDeleted = true;
        msg.deletedAt = new Date();
        msg.deletedBy = authState.userId;
        await msg.save();

        const deletePayload = {
          messageId: msg._id.toString(),
          roomId: msg.roomId,
          isDeleted: true
        };

        io.to(msg.roomId).emit('chat:message:delete', deletePayload);
        if (typeof ack === 'function') ack({ success: true, message: deletePayload });
      } catch (err) {
        console.error('[CHAT-V2] delete error:', err.message);
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    socket.on('chat:reaction:toggle', async ({ messageId, emoji, token }, ack) => {
      const authState = authenticateSocketToken(token);
      if (!authState) {
        if (typeof ack === 'function') ack({ success: false, error: 'UNAUTHORIZED' });
        return;
      }
      if (!messageId || !emoji) {
        if (typeof ack === 'function') ack({ success: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      try {
        const msg = await Message.findById(messageId);
        if (!msg || msg.isDeleted) {
          if (typeof ack === 'function') ack({ success: false, error: 'NOT_FOUND' });
          return;
        }
        const session = await Session.findOne({ roomId: msg.roomId });
        if (session && session.status !== 'active') {
          if (typeof ack === 'function') ack({ success: false, error: 'READ_ONLY_SESSION' });
          return;
        }

        // Toggle reaction for user
        const existingIdx = (msg.reactions || []).findIndex(
          r => r.emoji === emoji && r.user && r.user.toString() === authState.userId
        );

        if (existingIdx >= 0) {
          msg.reactions.splice(existingIdx, 1);
        } else {
          if (!msg.reactions) msg.reactions = [];
          msg.reactions.push({
            emoji,
            user: authState.userId,
            userRole: authState.userRole,
            createdAt: new Date()
          });
        }
        await msg.save();

        const reactionPayload = {
          messageId: msg._id.toString(),
          roomId: msg.roomId,
          reactions: msg.reactions
        };

        io.to(msg.roomId).emit('chat:reaction:update', reactionPayload);
        if (typeof ack === 'function') ack({ success: true, reactions: msg.reactions });
      } catch (err) {
        console.error('[CHAT-V2] reaction error:', err.message);
        if (typeof ack === 'function') ack({ success: false, error: err.message });
      }
    });

    socket.on('chat:read', ({ messageId, roomId, token }) => {
      const authState = authenticateSocketToken(token);
      if (authState && roomId && messageId) {
        socket.to(roomId).emit('chat:read', { messageId, readBy: authState.userId, readAt: new Date() });
      }
    });

    // ─── 4. LEGACY EVENT COMPATIBILITY ────────────────────────────────────────
    socket.on('join-room', (roomId) => {
      if (roomId) {
        socket.join(roomId);
        console.log(`[CHAT-V2] legacy join-room: ${roomId} socket=${socket.id}`);
      }
    });

    socket.on('send-message', async (data, ack) => {
      // Proxy legacy send-message into chat:send logic
      const roomId = data.roomId;
      const text = data.text;
      const clientMessageId = data.clientMessageId || `legacy_${Date.now()}`;
      const token = data.token;
      
      const authState = authenticateSocketToken(token) || { userId: socket.userId, userRole: data.senderRole || socket.userRole };
      
      try {
        if (mongoose.connection.readyState === 1) {
          const session = await Session.findOne({ roomId });
          if (session && session.status !== 'active') {
            console.warn(`[CHAT-V2] legacy send-message rejected - session ${session._id} is status '${session.status}'`);
            if (typeof ack === 'function') ack({ success: false, error: 'READ_ONLY_SESSION', message: 'This session has ended and is read-only.' });
            return;
          }
        }
      } catch (e) {}

      let msg = null;
      try {
        const validSender = (authState.userId && mongoose.Types.ObjectId.isValid(authState.userId)) ? authState.userId : null;
        if (mongoose.connection.readyState === 1) {
          msg = await Message.create({ roomId, sender: validSender, senderRole: authState.userRole, text });
        } else {
          msg = { _id: Date.now().toString(), roomId, senderRole: authState.userRole, text, createdAt: new Date() };
        }
      } catch (err) {
        console.error('[CHAT-V2] legacy send-message save notice:', err.message);
      }

      const canonicalMessage = {
        _id: msg ? (msg._id ? msg._id.toString() : Date.now().toString()) : Date.now().toString(),
        clientMessageId,
        roomId,
        senderRole: authState.userRole,
        text: msg ? msg.text : text,
        createdAt: msg ? msg.createdAt : new Date(),
        status: 'sent'
      };

      io.to(roomId).emit('chat:message', canonicalMessage);
      io.to(roomId).emit('receive-message', canonicalMessage);

      if (typeof ack === 'function') {
        ack({ success: true, message: canonicalMessage });
      }
    });

    socket.on('trigger-crisis', ({ roomId, crisisLevel, triggers }) => {
      if (roomId) io.to(roomId).emit('crisis-alert', { crisisLevel, triggers });
    });

    socket.on('typing', ({ roomId, senderRole }) => {
      if (roomId) {
        socket.to(roomId).emit('chat:typing:start', { senderRole: senderRole || socket.userRole });
        socket.to(roomId).emit('typing', { senderRole: senderRole || socket.userRole });
      }
    });

    socket.on('stop-typing', ({ roomId, senderRole }) => {
      if (roomId) {
        socket.to(roomId).emit('chat:typing:stop', { senderRole: senderRole || socket.userRole });
        socket.to(roomId).emit('stop-typing', { senderRole: senderRole || socket.userRole });
      }
    });

    socket.on('leave-room', (roomId) => {
      if (roomId) socket.leave(roomId);
    });

    // ─── 5. WEBRTC CALL SIGNALING ─────────────────────────────────────────────
    socket.on('call-offer', ({ roomId, offer, callType }) => socket.to(roomId).emit('call-offer', { offer, callType }));
    socket.on('call-answer', ({ roomId, answer }) => socket.to(roomId).emit('call-answer', { answer }));
    socket.on('call-ice', ({ roomId, candidate }) => socket.to(roomId).emit('call-ice', { candidate }));
    socket.on('call-ended', ({ roomId }) => socket.to(roomId).emit('call-ended', { roomId }));

    socket.on('call-user', ({ userToCall, signalData, from, name, callType }) => {
      io.to(userToCall).emit('call-user', { signal: signalData, from, name, callType });
    });

    socket.on('answer-call', (data) => io.to(data.to).emit('call-accepted', data.signal));
    socket.on('reject-call', (data) => io.to(data.to).emit('call-ended'));
    socket.on('end-call', (data) => io.to(data.to).emit('call-ended'));

    socket.on('disconnect', () => {
      console.log(`[CHAT-V2] socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = setupSocketIO;
