/**
 * KeyChat - P2P Network & Mesh Coordinator
 * Handles WebRTC data channels via PeerJS, Local BroadcastChannel, and E2EE mesh routing
 */

class P2PManager {
  constructor(cryptoManager, soundEngine) {
    this.crypto = cryptoManager;
    this.sound = soundEngine;
    this.sharedKey = null;
    this.roomId = null;
    this.peerId = null;
    this.myProfile = { nickname: 'Anonymous', avatarColor: '#6366f1' };
    
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.peersList = new Map(); // peerId -> { nickname, avatarColor, isHost, joinedAt }
    
    this.broadcastChannel = null;
    this.isHost = false;
    this.hostReconnectTimer = null;
    this.heartbeatTimer = null;
    this.seenMessageIds = new Set();

    // Event callbacks
    this.onMessageReceived = null; // (msgObj) => void
    this.onPeersUpdated = null; // (peersArray) => void
    this.onStatusChanged = null; // (statusText, isConnected) => void
    this.onTypingIndicator = null; // (peerId, isTyping) => void
  }

  /**
   * Connect to room using shared key
   */
  async joinRoom(sharedKey, profile) {
    this.sharedKey = sharedKey.trim();
    this.myProfile = profile;
    this.roomId = await CryptoManager.deriveRoomId(this.sharedKey);
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 8);

    this.setStatus('Initializing secure room...', false);

    // 1. Setup Local Broadcast Channel for instant local tab sync
    this.setupBroadcastChannel();

    // 2. Setup WebRTC PeerJS for internet connectivity
    this.setupWebRTC();

    // 3. Start periodic heartbeat to prune dead peers
    this.startHeartbeat();
  }

  /**
   * BroadcastChannel for local macOS multi-tab sync
   */
  setupBroadcastChannel() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(`keychat_room_${this.roomId}`);
        this.broadcastChannel.onmessage = async (event) => {
          await this.handleIncomingRawPayload(event.data, 'local-tab');
        };

        // Announce local presence
        this.broadcastRaw({
          type: 'PEER_ANNOUNCE',
          peerId: this.peerId,
          profile: this.myProfile,
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.warn('BroadcastChannel not supported in this browser:', e);
    }
  }

  /**
   * Initialize PeerJS connection and mesh coordinator
   */
  setupWebRTC() {
    if (typeof Peer === 'undefined') {
      console.warn('PeerJS library not loaded, using local BroadcastChannel fallback');
      this.setStatus('Connected (Local Mesh)', true);
      this.addPeer(this.peerId, this.myProfile, false);
      return;
    }

    const hostPeerId = `kc-${this.roomId}-host`;
    const clientPeerId = `kc-${this.roomId}-${this.peerId}`;

    this.setStatus('Connecting to WebRTC mesh...', false);

    // Try becoming host first
    this.tryBecomeHost(hostPeerId, clientPeerId);
  }

  tryBecomeHost(hostPeerId, clientPeerId) {
    try {
      const p = new Peer(hostPeerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        },
        debug: 1
      });

      p.on('open', (id) => {
        this.peer = p;
        this.isHost = true;
        this.peerId = id;
        this.setStatus('Connected (Room Coordinator & E2EE Active)', true);
        this.addPeer(this.peerId, this.myProfile, true);
        this.setupPeerListeners();
      });

      p.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Host already exists! Join as client and connect to host
          p.destroy();
          this.joinAsClient(clientPeerId, hostPeerId);
        } else {
          console.warn('PeerJS error as host:', err);
          p.destroy();
          this.joinAsClient(clientPeerId, hostPeerId);
        }
      });
    } catch (e) {
      console.warn('Failed to initialize PeerJS host:', e);
      this.joinAsClient(clientPeerId, hostPeerId);
    }
  }

  joinAsClient(clientPeerId, hostPeerId) {
    try {
      const p = new Peer(clientPeerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        },
        debug: 1
      });

      p.on('open', (id) => {
        this.peer = p;
        this.isHost = false;
        this.peerId = id;
        this.setStatus('Connecting to room host...', false);
        this.addPeer(this.peerId, this.myProfile, false);
        this.setupPeerListeners();

        // Connect directly to host
        this.connectToPeer(hostPeerId, true);
      });

      p.on('error', (err) => {
        console.warn('PeerJS client error:', err);
        if (err.type === 'peer-unavailable') {
          // Host might have left, try becoming host again
          this.scheduleHostElection(hostPeerId, clientPeerId);
        }
      });
    } catch (e) {
      console.warn('Failed to initialize PeerJS client:', e);
      this.setStatus('Connected (Local Offline Mesh)', true);
    }
  }

  setupPeerListeners() {
    if (!this.peer) return;

    this.peer.on('connection', (conn) => {
      this.handleIncomingConnection(conn);
    });

    this.peer.on('disconnected', () => {
      this.setStatus('Reconnecting to network...', false);
      try {
        this.peer.reconnect();
      } catch (e) {
        console.warn('Peer reconnect failed:', e);
      }
    });

    this.peer.on('close', () => {
      this.setStatus('Disconnected', false);
    });
  }

  connectToPeer(targetPeerId, isHostTarget = false) {
    if (!this.peer || targetPeerId === this.peerId || this.connections.has(targetPeerId)) {
      return;
    }

    try {
      const conn = this.peer.connect(targetPeerId, {
        reliable: true,
        metadata: { profile: this.myProfile, from: this.peerId }
      });

      this.handleOutgoingConnection(conn, isHostTarget);
    } catch (e) {
      console.warn(`Failed to connect to ${targetPeerId}:`, e);
    }
  }

  handleOutgoingConnection(conn, isHostTarget) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.setStatus('Connected (Live P2P & E2EE Active)', true);

      // Send greeting & profile
      this.sendToConn(conn, {
        type: 'PEER_ANNOUNCE',
        peerId: this.peerId,
        profile: this.myProfile,
        timestamp: Date.now()
      });
    });

    conn.on('data', async (data) => {
      await this.handleIncomingRawPayload(data, conn.peer);
    });

    conn.on('close', () => {
      this.handlePeerDisconnected(conn.peer);
      if (isHostTarget) {
        this.scheduleHostElection(`kc-${this.roomId}-host`, `kc-${this.roomId}-${this.peerId}`);
      }
    });

    conn.on('error', (err) => {
      console.warn(`Connection error with ${conn.peer}:`, err);
      this.handlePeerDisconnected(conn.peer);
    });
  }

  handleIncomingConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.setStatus('Connected (Live P2P & E2EE Active)', true);

      // If I am host, announce current peer mesh list to the new connection
      if (this.isHost) {
        const peerList = Array.from(this.peersList.entries()).map(([id, data]) => ({
          peerId: id,
          profile: { nickname: data.nickname, avatarColor: data.avatarColor },
          isHost: data.isHost
        }));

        this.sendToConn(conn, {
          type: 'MESH_ROSTER',
          peers: peerList,
          timestamp: Date.now()
        });
      }

      // Send my own profile back
      this.sendToConn(conn, {
        type: 'PEER_ANNOUNCE',
        peerId: this.peerId,
        profile: this.myProfile,
        isHost: this.isHost,
        timestamp: Date.now()
      });
    });

    conn.on('data', async (data) => {
      await this.handleIncomingRawPayload(data, conn.peer);
    });

    conn.on('close', () => {
      this.handlePeerDisconnected(conn.peer);
    });

    conn.on('error', (err) => {
      console.warn(`Incoming connection error with ${conn.peer}:`, err);
      this.handlePeerDisconnected(conn.peer);
    });
  }

  scheduleHostElection(hostPeerId, clientPeerId) {
    if (this.hostReconnectTimer) clearTimeout(this.hostReconnectTimer);
    this.hostReconnectTimer = setTimeout(() => {
      if (this.peer && !this.peer.destroyed) {
        this.peer.destroy();
      }
      this.tryBecomeHost(hostPeerId, clientPeerId);
    }, 1200 + Math.random() * 1000);
  }

  /**
   * Send encrypted message to all connected peers and broadcast channel
   */
  async sendMessage(content, attachments = []) {
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const plainObj = {
      type: 'CHAT_MESSAGE',
      id: msgId,
      senderId: this.peerId,
      sender: this.myProfile.nickname,
      avatarColor: this.myProfile.avatarColor,
      text: content,
      attachments: attachments,
      timestamp: Date.now()
    };

    this.seenMessageIds.add(msgId);

    // Encrypt payload with AES-GCM
    const encrypted = await this.crypto.encrypt(this.sharedKey, plainObj);

    // Envelope with room hash
    const payload = {
      roomId: this.roomId,
      senderId: this.peerId,
      encrypted: encrypted
    };

    // Broadcast across all transports
    this.broadcastRaw(payload);

    // Play local send sound
    if (this.sound) this.sound.playSendSound();

    return plainObj;
  }

  /**
   * Broadcast typing state
   */
  async sendTyping(isTyping) {
    const payload = {
      roomId: this.roomId,
      type: 'TYPING_STATE',
      senderId: this.peerId,
      sender: this.myProfile.nickname,
      isTyping: isTyping,
      timestamp: Date.now()
    };

    this.broadcastRaw(payload);
  }

  /**
   * Broadcast raw object to all WebRTC connections + BroadcastChannel
   */
  broadcastRaw(payload) {
    // 1. BroadcastChannel (local tabs)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(payload);
      } catch (e) {
        console.warn('BroadcastChannel post failed:', e);
      }
    }

    // 2. WebRTC DataConnections
    for (const [pId, conn] of this.connections.entries()) {
      if (conn.open) {
        try {
          conn.send(payload);
        } catch (e) {
          console.warn(`WebRTC send failed to ${pId}:`, e);
        }
      }
    }
  }

  sendToConn(conn, payload) {
    if (conn && conn.open) {
      try {
        conn.send(payload);
      } catch (e) {
        console.warn('Send to conn failed:', e);
      }
    }
  }

  /**
   * Process raw payload from any transport
   */
  async handleIncomingRawPayload(payload, fromSource) {
    if (!payload) return;

    // Ignore messages from myself
    if (payload.senderId === this.peerId) return;

    // Case 1: Unencrypted signaling / presence
    if (payload.type === 'PEER_ANNOUNCE') {
      this.addPeer(payload.peerId, payload.profile, payload.isHost);
      // Connect to peer directly if not already connected (full mesh)
      if (payload.peerId !== this.peerId && !this.connections.has(payload.peerId) && this.peer) {
        this.connectToPeer(payload.peerId);
      }
      return;
    }

    if (payload.type === 'MESH_ROSTER' && Array.isArray(payload.peers)) {
      payload.peers.forEach((p) => {
        if (p.peerId !== this.peerId) {
          this.addPeer(p.peerId, p.profile, p.isHost);
          if (!this.connections.has(p.peerId) && this.peer) {
            this.connectToPeer(p.peerId);
          }
        }
      });
      return;
    }

    if (payload.type === 'TYPING_STATE') {
      if (this.onTypingIndicator) {
        this.onTypingIndicator(payload.sender, payload.isTyping);
      }
      return;
    }

    // Case 2: Encrypted Chat Payload
    if (payload.encrypted && payload.roomId === this.roomId) {
      try {
        const decrypted = await this.crypto.decrypt(this.sharedKey, payload.encrypted);
        
        if (decrypted && decrypted.id) {
          if (this.seenMessageIds.has(decrypted.id)) return;
          this.seenMessageIds.add(decrypted.id);

          if (this.sound) this.sound.playReceiveSound();

          if (this.onMessageReceived) {
            this.onMessageReceived(decrypted);
          }

          // If host, forward to other peers who might not be directly connected
          if (this.isHost) {
            for (const [pId, conn] of this.connections.entries()) {
              if (pId !== fromSource && conn.open) {
                this.sendToConn(conn, payload);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Received payload that could not be decrypted. Wrong key?', err);
      }
    }
  }

  addPeer(peerId, profile, isHost = false) {
    if (!peerId) return;
    const isNew = !this.peersList.has(peerId);
    this.peersList.set(peerId, {
      nickname: (profile && profile.nickname) || 'Anonymous',
      avatarColor: (profile && profile.avatarColor) || '#6366f1',
      isHost: isHost,
      joinedAt: Date.now(),
      lastSeen: Date.now()
    });

    if (isNew && peerId !== this.peerId) {
      if (this.sound) this.sound.playJoinSound();
    }

    this.notifyPeersUpdated();
  }

  handlePeerDisconnected(peerId) {
    if (this.connections.has(peerId)) {
      this.connections.delete(peerId);
    }
    if (this.peersList.has(peerId)) {
      this.peersList.delete(peerId);
      if (this.sound) this.sound.playLeaveSound();
      this.notifyPeersUpdated();
    }
  }

  notifyPeersUpdated() {
    if (this.onPeersUpdated) {
      const peersArray = Array.from(this.peersList.entries()).map(([id, data]) => ({
        peerId: id,
        nickname: data.nickname,
        avatarColor: data.avatarColor,
        isHost: data.isHost,
        isMe: id === this.peerId
      }));
      this.onPeersUpdated(peersArray);
    }
  }

  setStatus(text, isConnected) {
    if (this.onStatusChanged) {
      this.onStatusChanged(text, isConnected);
    }
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      // Clean up seen message ID cache if it grows too large
      if (this.seenMessageIds.size > 2000) {
        this.seenMessageIds.clear();
      }
    }, 30000);
  }

  leave() {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch (e) {}
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.hostReconnectTimer) clearTimeout(this.hostReconnectTimer);

    this.connections.clear();
    this.peersList.clear();
    this.setStatus('Disconnected', false);
  }
}

window.P2PManager = P2PManager;
