/**
 * KeyChat - Global Realtime Mesh Network (Multi-Transport P2P & WebSocket Mesh)
 * E2EE AES-256-GCM + MQTT WebSocket Mesh + WebRTC + Local BroadcastChannel
 */

class P2PManager {
  constructor(cryptoManager, soundEngine) {
    this.crypto = cryptoManager;
    this.sound = soundEngine;
    this.sharedKey = null;
    this.roomId = null;
    this.peerId = null;
    this.myProfile = { nickname: 'Anonymous', avatarColor: '#6366f1' };
    
    // Transports
    this.mqttClient = null;
    this.mqttConnected = false;
    this.broadcastChannel = null;
    this.peer = null;
    
    // State & Roster
    this.peersList = new Map(); // peerId -> { nickname, avatarColor, isHost, lastSeen, joinedAt }
    this.seenMessageIds = new Set();
    this.presenceInterval = null;
    this.pruneInterval = null;

    // Public secure MQTT WebSocket brokers (failover list)
    this.brokers = [
      { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' },
      { host: 'broker.emqx.io', port: 8084, path: '/mqtt' }
    ];
    this.currentBrokerIndex = 0;

    // Callbacks
    this.onMessageReceived = null;
    this.onPeersUpdated = null;
    this.onStatusChanged = null;
    this.onTypingIndicator = null;
  }

  /**
   * Connect to room with shared key
   */
  async joinRoom(sharedKey, profile) {
    this.sharedKey = sharedKey.trim();
    this.myProfile = profile;
    this.roomId = await CryptoManager.deriveRoomId(this.sharedKey);
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 10);

    this.setStatus('Connecting to secure global room...', false);

    // Register myself in peers roster
    this.addPeer(this.peerId, this.myProfile, false);

    // 1. Setup Local BroadcastChannel (instant local tab sync)
    this.setupBroadcastChannel();

    // 2. Setup Secure MQTT WebSocket Relay (Global internet connectivity)
    this.connectMqtt();

    // 3. Setup WebRTC PeerJS mesh in background
    this.setupWebRTC();

    // 4. Start presence heartbeat & pruning
    this.startPresenceEngine();
  }

  /**
   * Local BroadcastChannel for instant local macOS multi-tab sync
   */
  setupBroadcastChannel() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(`keychat_room_${this.roomId}`);
        this.broadcastChannel.onmessage = async (event) => {
          await this.handleIncomingRawPayload(event.data, 'local-tab');
        };

        // Broadcast local presence
        this.broadcastRaw({
          type: 'PEER_ANNOUNCE',
          peerId: this.peerId,
          profile: this.myProfile,
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  /**
   * Secure MQTT WebSocket Client (Zero-config, global internet sync)
   */
  connectMqtt() {
    if (typeof Paho === 'undefined' || !Paho.MQTT) {
      console.warn('Paho MQTT library not loaded, using local BroadcastChannel fallback');
      this.setStatus('Connected (Local Mesh)', true);
      return;
    }

    const broker = this.brokers[this.currentBrokerIndex];
    const clientId = `kc_${this.roomId.substring(0, 6)}_${this.peerId}_${Math.random().toString(36).substring(2, 6)}`;

    try {
      this.mqttClient = new Paho.MQTT.Client(broker.host, Number(broker.port), broker.path, clientId);

      this.mqttClient.onConnectionLost = (responseObject) => {
        this.mqttConnected = false;
        if (responseObject.errorCode !== 0) {
          console.warn('MQTT connection lost:', responseObject.errorMessage);
          this.setStatus('Reconnecting to network...', false);
          // Try next broker
          this.currentBrokerIndex = (this.currentBrokerIndex + 1) % this.brokers.length;
          setTimeout(() => this.connectMqtt(), 2000);
        }
      };

      this.mqttClient.onMessageArrived = async (message) => {
        try {
          const payload = JSON.parse(message.payloadString);
          await this.handleIncomingRawPayload(payload, 'mqtt');
        } catch (err) {
          console.warn('MQTT payload parse error:', err);
        }
      };

      this.mqttClient.connect({
        useSSL: true,
        timeout: 6,
        keepAliveInterval: 25,
        cleanSession: true,
        onSuccess: () => {
          this.mqttConnected = true;
          this.setStatus('Connected (Live E2EE Active)', true);

          // Subscribe to all topics for this room
          const topic = `keychat/v2/${this.roomId}/#`;
          this.mqttClient.subscribe(topic, { qos: 1 });

          // Send immediate peer announcement
          this.sendPresence(true);
        },
        onFailure: (err) => {
          console.warn(`MQTT connect failed to ${broker.host}:`, err);
          this.mqttConnected = false;
          // Failover to next broker
          this.currentBrokerIndex = (this.currentBrokerIndex + 1) % this.brokers.length;
          setTimeout(() => this.connectMqtt(), 1500);
        }
      });
    } catch (e) {
      console.warn('Failed to initialize MQTT client:', e);
    }
  }

  /**
   * Optional WebRTC PeerJS mesh setup
   */
  setupWebRTC() {
    if (typeof Peer === 'undefined') return;

    try {
      const p = new Peer(`kc-${this.roomId}-${this.peerId}`, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        },
        debug: 0
      });

      p.on('open', () => {
        this.peer = p;
      });

      p.on('error', (e) => {
        console.warn('PeerJS background mesh error:', e);
      });
    } catch (e) {
      console.warn('PeerJS init failed:', e);
    }
  }

  /**
   * Start periodic presence heartbeat & roster cleanup
   */
  startPresenceEngine() {
    // Send presence heartbeat every 4 seconds
    this.presenceInterval = setInterval(() => {
      this.sendPresence(false);
    }, 4000);

    // Prune peers who haven't pinged in > 10 seconds
    this.pruneInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const [pId, data] of this.peersList.entries()) {
        if (pId !== this.peerId && now - data.lastSeen > 10000) {
          this.peersList.delete(pId);
          changed = true;
          if (this.sound) this.sound.playLeaveSound();
        }
      }

      if (changed) {
        this.notifyPeersUpdated();
      }
    }, 3000);
  }

  sendPresence(isAnnounce = false) {
    const payload = {
      type: isAnnounce ? 'PEER_ANNOUNCE' : 'PEER_HEARTBEAT',
      roomId: this.roomId,
      peerId: this.peerId,
      profile: this.myProfile,
      timestamp: Date.now()
    };
    this.broadcastRaw(payload, `keychat/v2/${this.roomId}/presence`);
  }

  /**
   * Send encrypted message across all network transports
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

    // Encrypt payload with AES-256-GCM
    const encrypted = await this.crypto.encrypt(this.sharedKey, plainObj);

    // Envelope
    const payload = {
      roomId: this.roomId,
      senderId: this.peerId,
      encrypted: encrypted,
      timestamp: Date.now()
    };

    // Broadcast
    this.broadcastRaw(payload, `keychat/v2/${this.roomId}/messages`);

    // Play local send sound
    if (this.sound) this.sound.playSendSound();

    return plainObj;
  }

  /**
   * Send typing state
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

    this.broadcastRaw(payload, `keychat/v2/${this.roomId}/typing`);
  }

  /**
   * Broadcast payload across MQTT and BroadcastChannel
   */
  broadcastRaw(payload, topic) {
    const targetTopic = topic || `keychat/v2/${this.roomId}/general`;
    const jsonStr = JSON.stringify(payload);

    // 1. MQTT WebSocket
    if (this.mqttClient && this.mqttConnected) {
      try {
        const message = new Paho.MQTT.Message(jsonStr);
        message.destinationName = targetTopic;
        message.qos = 1;
        this.mqttClient.send(message);
      } catch (e) {
        console.warn('MQTT publish error:', e);
      }
    }

    // 2. BroadcastChannel (local tabs on same Mac)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(payload);
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }
  }

  /**
   * Handle incoming raw payload from any transport
   */
  async handleIncomingRawPayload(payload, source) {
    if (!payload) return;

    // Ignore messages sent by myself
    if (payload.senderId === this.peerId) return;

    // Check room ID
    if (payload.roomId && payload.roomId !== this.roomId) return;

    // 1. Presence & Heartbeat
    if (payload.type === 'PEER_ANNOUNCE' || payload.type === 'PEER_HEARTBEAT') {
      this.addPeer(payload.peerId, payload.profile, false);
      return;
    }

    // 2. Typing indicator
    if (payload.type === 'TYPING_STATE') {
      if (this.onTypingIndicator) {
        this.onTypingIndicator(payload.sender, payload.isTyping);
      }
      return;
    }

    // 3. Encrypted Chat Message
    if (payload.encrypted) {
      try {
        const decrypted = await this.crypto.decrypt(this.sharedKey, payload.encrypted);
        
        if (decrypted && decrypted.id) {
          if (this.seenMessageIds.has(decrypted.id)) return;
          this.seenMessageIds.add(decrypted.id);

          if (this.sound) this.sound.playReceiveSound();

          if (this.onMessageReceived) {
            this.onMessageReceived(decrypted);
          }
        }
      } catch (err) {
        console.warn('Payload decryption failed. Mismatched shared key?', err);
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
      lastSeen: Date.now(),
      joinedAt: isNew ? Date.now() : (this.peersList.get(peerId).joinedAt || Date.now())
    });

    if (isNew && peerId !== this.peerId) {
      if (this.sound) this.sound.playJoinSound();
    }

    this.notifyPeersUpdated();
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

  leave() {
    // Send leave notice
    if (this.mqttClient && this.mqttConnected) {
      try {
        const leaveMsg = new Paho.MQTT.Message(JSON.stringify({
          type: 'PEER_LEAVE',
          roomId: this.roomId,
          peerId: this.peerId
        }));
        leaveMsg.destinationName = `keychat/v2/${this.roomId}/presence`;
        this.mqttClient.send(leaveMsg);
        this.mqttClient.disconnect();
      } catch (e) {}
    }

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

    if (this.presenceInterval) clearInterval(this.presenceInterval);
    if (this.pruneInterval) clearInterval(this.pruneInterval);

    this.peersList.clear();
    this.setStatus('Disconnected', false);
  }
}

window.P2PManager = P2PManager;
