/**
 * CareNexus Global Frontend Configuration & Socket URL Manager
 */

(function () {
  'use strict';

  function getSocketBaseUrl() {
    if (typeof window !== 'undefined' && window.CARENEXUS_SOCKET_URL) {
      return window.CARENEXUS_SOCKET_URL;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('care_socket_url')) {
      return localStorage.getItem('care_socket_url');
    }

    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname;
      // Local development environment
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return window.location.origin;
      }
    }

    // Production Node/Express Socket.IO Backend URL (Render web service)
    return 'https://carenexus-9olf.onrender.com';
  }

  window.getSocketBaseUrl = getSocketBaseUrl;

  window.getCareNexusSocket = function () {
    if (window._careNexusSocket && window._careNexusSocket.connected) {
      return window._careNexusSocket;
    }

    if (typeof io === 'undefined') {
      console.error('[CHAT-V2] Socket.IO client library (io) is missing!');
      return null;
    }

    const token = localStorage.getItem('token') || localStorage.getItem('care_token');
    const socketUrl = getSocketBaseUrl();

    console.log(`[CHAT-V2] Socket URL: ${socketUrl}`);
    console.log(`[CHAT-V2] connecting...`);

    // Polling-first connection strategy ensures smooth HTTP handshake followed by seamless WebSocket upgrade
    const socketOpts = {
      auth: { token: token },
      transports: ['polling', 'websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000
    };

    if (!window._careNexusSocket) {
      window._careNexusSocket = io(socketUrl, socketOpts);

      window._careNexusSocket.on('connect', () => {
        const transportName = window._careNexusSocket.io?.engine?.transport?.name || 'unknown';
        console.log(`[CHAT-V2] connected socket=${window._careNexusSocket.id}`);
        console.log(`[CHAT-V2] transport=${transportName}`);

        const roomId = localStorage.getItem('roomId');
        const sessionId = localStorage.getItem('sessionId');
        if (roomId) {
          console.log(`[CHAT-V2] joining room: ${roomId} session: ${sessionId}`);
          window._careNexusSocket.emit('chat:join', { sessionId, roomId, token }, (ack) => {
            if (ack && ack.success) {
              console.log(`[CHAT-V2] joined room: ${roomId} members=${ack.membersCount}`);
            } else {
              console.warn(`[CHAT-V2] join notice:`, ack ? ack.error : 'No ACK');
            }
          });
        }
      });

      window._careNexusSocket.io?.engine?.on('upgrade', (transport) => {
        console.log(`[CHAT-V2] transport upgraded to=${transport.name}`);
      });

      window._careNexusSocket.on('connect_error', (err) => {
        console.warn(`[CHAT-V2] connection error to ${socketUrl}:`, err.message);
      });
    }

    return window._careNexusSocket;
  };
})();
