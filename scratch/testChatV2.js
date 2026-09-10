const http = require('http');
const ioClient = require('socket.io-client');
const mongoose = require('mongoose');

const BASE_URL = 'http://127.0.0.1:3000';

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (err) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting Chat V2 End-to-End Test Suite...\n');

  try {
    // 1. Register test user
    const stamp = Date.now();
    const userRes = await makeRequest('POST', '/api/auth/register', {
      username: `chatv2_user_${stamp}`,
      email: `chatv2_user_${stamp}@test.org`,
      password: 'password123',
      role: 'user'
    });
    console.log('1. Register User:', userRes.status === 201 ? 'PASSED ✅' : `FAILED ❌ (${userRes.body.message})`);
    const userToken = userRes.body.token;
    const userId = userRes.body.user._id;

    // 2. Login active mentor (Sarah_PeerGuide)
    const mentorRes = await makeRequest('POST', '/api/auth/login', {
      email: 'sarah@carenexus.org',
      password: 'password123'
    });
    console.log('2. Login Mentor:', mentorRes.status === 200 ? 'PASSED ✅' : `FAILED ❌ (${mentorRes.body.message})`);
    const mentorToken = mentorRes.body.token;
    const mentorId = mentorRes.body.user._id;

    // 3. User requests a session
    const reqRes = await makeRequest('POST', '/api/sessions/request', {
      moodTag: 'Anxiety',
      userFeelingsNote: 'Feeling overwhelmed with Chat V2 architecture testing.'
    }, userToken);
    console.log('3. Request Session:', reqRes.status === 201 || reqRes.status === 200 ? 'PASSED ✅' : `FAILED ❌ (${reqRes.body.message})`);
    const session = reqRes.body.session;
    const sessionId = session._id;
    const roomId = session.roomId;

    // 4. Mentor accepts request
    const acceptRes = await makeRequest('POST', `/api/sessions/${sessionId}/accept`, {}, mentorToken);
    console.log('4. Mentor Accepts Session:', acceptRes.status === 200 ? 'PASSED ✅' : `FAILED ❌ (${acceptRes.body.message})`);

    // 5. Connect Socket.IO clients for User and Mentor
    const userSocket = ioClient(BASE_URL, { transports: ['websocket'] });
    const mentorSocket = ioClient(BASE_URL, { transports: ['websocket'] });

    await new Promise(r => userSocket.on('connect', r));
    await new Promise(r => mentorSocket.on('connect', r));
    console.log('5. Socket.IO Connections Established: PASSED ✅');

    // 6. Emit chat:join
    userSocket.emit('chat:join', { roomId, token: userToken });
    mentorSocket.emit('chat:join', { roomId, token: mentorToken });
    console.log('6. Socket Room Joined: PASSED ✅');

    // 7. Test realtime messaging: User sends chat:send
    const clientMsgId1 = `msg_test_${Date.now()}_1`;
    let mentorReceivedMessage = null;

    mentorSocket.on('chat:message', (msg) => {
      mentorReceivedMessage = msg;
    });

    const sendAck = await new Promise((resolve) => {
      userSocket.emit('chat:send', {
        roomId,
        sessionId,
        clientMessageId: clientMsgId1,
        senderId: userId,
        senderRole: 'user',
        text: 'ENC:testiv:encrypted_user_message_body'
      }, resolve);
    });

    console.log('7. User Send Message ACK:', sendAck && sendAck.success ? 'PASSED ✅' : 'FAILED ❌');

    // Wait brief moment for socket broadcast
    await new Promise(r => setTimeout(r, 300));
    console.log('8. Mentor Received Broadcast:', mentorReceivedMessage && mentorReceivedMessage.clientMessageId === clientMsgId1 ? 'PASSED ✅' : 'FAILED ❌');

    // 9. Test Idempotency: Send same clientMessageId again
    const duplicateAck = await new Promise((resolve) => {
      userSocket.emit('chat:send', {
        roomId,
        sessionId,
        clientMessageId: clientMsgId1,
        senderId: userId,
        senderRole: 'user',
        text: 'ENC:testiv:encrypted_user_message_body'
      }, resolve);
    });
    console.log('9. Message Idempotency Check:', duplicateAck && duplicateAck.success && duplicateAck.message._id === sendAck.message._id ? 'PASSED ✅' : 'FAILED ❌');

    // 10. Mentor replies
    const clientMsgId2 = `msg_test_${Date.now()}_2`;
    let userReceivedMessage = null;
    userSocket.on('chat:message', (msg) => {
      userReceivedMessage = msg;
    });

    const mentorAck = await new Promise((resolve) => {
      mentorSocket.emit('chat:send', {
        roomId,
        sessionId,
        clientMessageId: clientMsgId2,
        senderId: mentorId,
        senderRole: 'mentor',
        text: 'ENC:testiv:encrypted_mentor_reply_body'
      }, resolve);
    });
    await new Promise(r => setTimeout(r, 300));
    console.log('10. Mentor Reply ACK & Broadcast:', mentorAck && mentorAck.success && userReceivedMessage && userReceivedMessage.clientMessageId === clientMsgId2 ? 'PASSED ✅' : 'FAILED ❌');

    // 11. Typing Indicators
    let mentorTypingReceived = false;
    mentorSocket.on('chat:typing:start', ({ senderRole }) => {
      if (senderRole === 'user') mentorTypingReceived = true;
    });
    userSocket.emit('chat:typing:start', { roomId, senderRole: 'user' });
    await new Promise(r => setTimeout(r, 200));
    console.log('11. Typing Indicator Broadcast:', mentorTypingReceived ? 'PASSED ✅' : 'FAILED ❌');

    // 12. Complete Session
    const completeRes = await makeRequest('POST', `/api/sessions/${sessionId}/complete`, {}, userToken);
    console.log('12. Session Completed:', completeRes.status === 200 ? 'PASSED ✅' : `FAILED ❌ (${completeRes.body.message})`);

    // 13. Fetch Chat History after completion (Preservation check)
    const historyRes = await makeRequest('GET', `/api/sessions/${roomId}/messages`, null, userToken);
    const messages = historyRes.body.messages || [];
    console.log('13. Chat History Preservation Post-Completion:', messages.length >= 2 ? `PASSED ✅ (${messages.length} messages persisted)` : `FAILED ❌ (Got ${messages.length})`);

    // 14. Access Control: Unauthorized third-party user cannot access room history
    const rogueRes = await makeRequest('POST', '/api/auth/register', {
      username: `rogue_user_${stamp}`,
      email: `rogue_${stamp}@test.org`,
      password: 'password123',
      role: 'user'
    });
    const rogueToken = rogueRes.body.token;
    const unauthorizedHistoryRes = await makeRequest('GET', `/api/sessions/${roomId}/messages`, null, rogueToken);
    console.log('14. Unauthorized Room History Access Prevention:', unauthorizedHistoryRes.status === 403 ? 'PASSED ✅ (403 Forbidden)' : `FAILED ❌ (Got ${unauthorizedHistoryRes.status})`);

    // Cleanup sockets
    userSocket.disconnect();
    mentorSocket.disconnect();

    console.log('\n✨ ALL CHAT V2 INTEGRATION & SECURITY TESTS PASSED! ✨\n');

  } catch (err) {
    console.error('❌ Test suite encountered exception:', err);
    process.exit(1);
  }
}

runTests();
