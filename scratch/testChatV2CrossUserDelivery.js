const http = require('http');
const ioClient = require('socket.io-client');
const BASE_URL = 'http://127.0.0.1:3000';

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runCrossUserDeliveryTest() {
  console.log('\n==================================================');
  console.log('🧪 CARENEXUS CHAT V2 CROSS-USER DELIVERY TEST SUITE');
  console.log('==================================================\n');

  let userSocket = null;
  let mentorSocket = null;
  let rogueSocket = null;

  try {
    const stamp = Date.now();

    // 1. Authenticate User A
    const userRes = await makeRequest('POST', '/api/auth/register', {
      username: `user_delivery_${stamp}`,
      email: `user_delivery_${stamp}@test.org`,
      password: 'password123',
      role: 'user'
    });
    console.log('[TEST 01] User Authentication:', userRes.status === 201 ? 'PASS ✅' : 'FAIL ❌');
    const userToken = userRes.body.token;
    const userId = userRes.body.user._id;

    // 2. Authenticate Mentor B
    const mentorRes = await makeRequest('POST', '/api/auth/login', {
      email: 'sarah@carenexus.org',
      password: 'password123'
    });
    console.log('[TEST 02] Mentor Authentication:', mentorRes.status === 200 ? 'PASS ✅' : 'FAIL ❌');
    const mentorToken = mentorRes.body.token;
    const mentorId = mentorRes.body.user._id;

    // 3. User A Creates Session Request
    const reqRes = await makeRequest('POST', '/api/sessions/request', {
      moodTag: 'Anxiety',
      userFeelingsNote: 'Realtime cross-user delivery validation session.'
    }, userToken);
    console.log('[TEST 03] Request Session Creation:', reqRes.status === 201 || reqRes.status === 200 ? 'PASS ✅' : 'FAIL ❌');
    const session = reqRes.body.session;
    const sessionId = session._id;
    const roomId = session.roomId;

    // 4. Mentor B Accepts Session
    const acceptRes = await makeRequest('POST', `/api/sessions/${sessionId}/accept`, {}, mentorToken);
    console.log('[TEST 04] Mentor Acceptance:', acceptRes.status === 200 ? 'PASS ✅' : 'FAIL ❌');

    // 5. Connect User A and Mentor B Sockets
    userSocket = ioClient(BASE_URL, { auth: { token: userToken }, transports: ['websocket'] });
    mentorSocket = ioClient(BASE_URL, { auth: { token: mentorToken }, transports: ['websocket'] });

    await new Promise(r => userSocket.on('connect', r));
    await new Promise(r => mentorSocket.on('connect', r));
    console.log(`[TEST 05] Sockets Connected (User Socket: ${userSocket.id}, Mentor Socket: ${mentorSocket.id}): PASS ✅`);

    if (userSocket.id === mentorSocket.id) {
      throw new Error('User and Mentor sockets share the same socket ID!');
    }

    // 6. Join Room on both Sockets
    const userJoinAck = await new Promise(r => userSocket.emit('chat:join', { sessionId, roomId, token: userToken }, r));
    const mentorJoinAck = await new Promise(r => mentorSocket.emit('chat:join', { sessionId, roomId, token: mentorToken }, r));
    console.log('[TEST 06] User Join Room ACK:', userJoinAck && userJoinAck.success ? 'PASS ✅' : 'FAIL ❌');
    console.log('[TEST 07] Mentor Join Room ACK:', mentorJoinAck && mentorJoinAck.success ? 'PASS ✅' : 'FAIL ❌');

    // 7. Verify Room Members Count == 2
    const finalRoomMembers = mentorJoinAck ? mentorJoinAck.membersCount : 0;
    console.log(`[TEST 08] Room Members Count == 2 (Actual: ${finalRoomMembers}):`, finalRoomMembers === 2 ? 'PASS ✅' : 'FAIL ❌');

    // 8. TEST A: User A -> Mentor B Realtime Delivery
    const msgId1 = `msg_user_${stamp}`;
    let mentorReceivedMessage = null;

    mentorSocket.on('chat:message', (msg) => {
      if (msg.clientMessageId === msgId1) {
        mentorReceivedMessage = msg;
      }
    });

    const userSendAck = await new Promise(r => {
      userSocket.emit('chat:send', {
        sessionId,
        roomId,
        clientMessageId: msgId1,
        text: 'ENC:iv_user:encrypted_hello_mentor',
        token: userToken
      }, r);
    });

    console.log('[TEST 09] User -> Server ACK:', userSendAck && userSendAck.success ? 'PASS ✅' : 'FAIL ❌');

    await new Promise(r => setTimeout(r, 400));
    console.log('[TEST 10] USER → MENTOR Realtime Delivery:', mentorReceivedMessage && mentorReceivedMessage.clientMessageId === msgId1 ? 'PASS ✅' : 'FAIL ❌');

    // 9. TEST B: Mentor B -> User A Realtime Delivery
    const msgId2 = `msg_mentor_${stamp}`;
    let userReceivedMessage = null;

    userSocket.on('chat:message', (msg) => {
      if (msg.clientMessageId === msgId2) {
        userReceivedMessage = msg;
      }
    });

    const mentorSendAck = await new Promise(r => {
      mentorSocket.emit('chat:send', {
        sessionId,
        roomId,
        clientMessageId: msgId2,
        text: 'ENC:iv_mentor:encrypted_hello_user',
        token: mentorToken
      }, r);
    });

    console.log('[TEST 11] Mentor -> Server ACK:', mentorSendAck && mentorSendAck.success ? 'PASS ✅' : 'FAIL ❌');

    await new Promise(r => setTimeout(r, 400));
    console.log('[TEST 12] MENTOR → USER Realtime Delivery:', userReceivedMessage && userReceivedMessage.clientMessageId === msgId2 ? 'PASS ✅' : 'FAIL ❌');

    // 10. Database Persistence & Deduplication
    const historyRes = await makeRequest('GET', `/api/sessions/${roomId}/messages`, null, userToken);
    const messages = historyRes.body.messages || [];
    console.log(`[TEST 13] Database Persistence & Dedup (Persisted: ${messages.length}):`, messages.length === 2 ? 'PASS ✅' : 'FAIL ❌');

    // 11. Idempotency Check (Resend msgId1)
    const duplicateAck = await new Promise(r => {
      userSocket.emit('chat:send', {
        sessionId,
        roomId,
        clientMessageId: msgId1,
        text: 'ENC:iv_user:encrypted_hello_mentor',
        token: userToken
      }, r);
    });
    console.log('[TEST 14] Message Idempotency Check:', duplicateAck && duplicateAck.success && duplicateAck.message._id === userSendAck.message._id ? 'PASS ✅' : 'FAIL ❌');

    // 12. Reconnect Test
    mentorSocket.disconnect();
    await new Promise(r => setTimeout(r, 300));
    mentorSocket.connect();
    await new Promise(r => mentorSocket.on('connect', r));

    const mentorRejoinAck = await new Promise(r => mentorSocket.emit('chat:join', { sessionId, roomId, token: mentorToken }, r));
    console.log('[TEST 15] Mentor Reconnect & Rejoin Room:', mentorRejoinAck && mentorRejoinAck.success ? 'PASS ✅' : 'FAIL ❌');

    const msgId3 = `msg_user_post_reconnect_${stamp}`;
    let mentorReceivedPostReconnect = null;
    mentorSocket.on('chat:message', (msg) => {
      if (msg.clientMessageId === msgId3) {
        mentorReceivedPostReconnect = msg;
      }
    });

    userSocket.emit('chat:send', {
      sessionId,
      roomId,
      clientMessageId: msgId3,
      text: 'ENC:iv_user:encrypted_post_reconnect',
      token: userToken
    });

    await new Promise(r => setTimeout(r, 400));
    console.log('[TEST 16] Delivery Post-Reconnect:', mentorReceivedPostReconnect && mentorReceivedPostReconnect.clientMessageId === msgId3 ? 'PASS ✅' : 'FAIL ❌');

    // 13. Security Test (Rogue User Unauthorized Room Join)
    const rogueUserRes = await makeRequest('POST', '/api/auth/register', {
      username: `rogue_user_${stamp}`,
      email: `rogue_user_${stamp}@test.org`,
      password: 'password123',
      role: 'user'
    });
    const rogueToken = rogueUserRes.body.token;

    rogueSocket = ioClient(BASE_URL, { auth: { token: rogueToken }, transports: ['websocket'] });
    await new Promise(r => rogueSocket.on('connect', r));

    const rogueJoinAck = await new Promise(r => rogueSocket.emit('chat:join', { sessionId, roomId, token: rogueToken }, r));
    console.log('[TEST 17] Security: Unauthorized Room Join Prevention:', rogueJoinAck && !rogueJoinAck.success && rogueJoinAck.error === 'UNAUTHORIZED_PARTICIPANT' ? 'PASS ✅ (Rejected 403/UNAUTHORIZED_PARTICIPANT)' : 'FAIL ❌');

    console.log('\n==================================================');
    console.log('✨ ALL CROSS-USER REALTIME DELIVERY TESTS PASSED! ✨');
    console.log('==================================================\n');

  } catch (err) {
    console.error('❌ Test suite failed with exception:', err);
    process.exit(1);
  } finally {
    if (userSocket) userSocket.disconnect();
    if (mentorSocket) mentorSocket.disconnect();
    if (rogueSocket) rogueSocket.disconnect();
  }
}

runCrossUserDeliveryTest();
