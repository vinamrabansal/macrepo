/**
 * KeyChat - Main Application Controller
 * UI Management, Event Listeners, State Management & Chat Lifecycle
 */

document.addEventListener('DOMContentLoaded', () => {
  // Instances
  const cryptoManager = new CryptoManager();
  const soundEngine = new SoundEngine();
  const p2pManager = new P2PManager(cryptoManager, soundEngine);

  // State
  let currentKey = '';
  let currentProfile = {
    nickname: localStorage.getItem('keychat_nickname') || '',
    avatarColor: localStorage.getItem('keychat_color') || '#6366f1'
  };
  let pendingAttachment = null;
  let typingTimeout = null;
  let qrCodeInstance = null;

  // DOM Elements - Entry
  const entryContainer = document.getElementById('entryContainer');
  const joinForm = document.getElementById('joinForm');
  const inputSharedKey = document.getElementById('inputSharedKey');
  const inputNickname = document.getElementById('inputNickname');
  const btnRandomKey = document.getElementById('btnRandomKey');
  const btnToggleKeyVisibility = document.getElementById('btnToggleKeyVisibility');
  const colorSwatches = document.getElementById('colorSwatches');

  // DOM Elements - Sidebar & Header
  const sidebar = document.getElementById('sidebar');
  const btnOpenSidebar = document.getElementById('btnOpenSidebar');
  const btnCloseSidebar = document.getElementById('btnCloseSidebar');
  const sidebarKeyText = document.getElementById('sidebarKeyText');
  const btnSidebarCopyKey = document.getElementById('btnSidebarCopyKey');
  const badgeRoomId = document.getElementById('badgeRoomId');
  const peersCountBadge = document.getElementById('peersCountBadge');
  const peerList = document.getElementById('peerList');
  const myAvatarMini = document.getElementById('myAvatarMini');
  const myNameMini = document.getElementById('myNameMini');
  const headerRoomTitle = document.getElementById('headerRoomTitle');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const btnLeaveRoom = document.getElementById('btnLeaveRoom');

  // DOM Elements - Actions
  const btnOpenInviteModal = document.getElementById('btnOpenInviteModal');
  const btnToggleAudio = document.getElementById('btnToggleAudio');
  const btnToggleTheme = document.getElementById('btnToggleTheme');
  const btnClearChat = document.getElementById('btnClearChat');

  // DOM Elements - Chat & Input
  const messagesContainer = document.getElementById('messagesContainer');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const btnAttachImage = document.getElementById('btnAttachImage');
  const imageFileInput = document.getElementById('imageFileInput');
  const attachmentPreviewBar = document.getElementById('attachmentPreviewBar');
  const attachmentThumb = document.getElementById('attachmentThumb');
  const attachmentInfo = document.getElementById('attachmentInfo');
  const btnRemoveAttachment = document.getElementById('btnRemoveAttachment');
  const typingIndicator = document.getElementById('typingIndicator');
  const typingText = document.getElementById('typingText');

  // DOM Elements - Modal & Toast
  const inviteModal = document.getElementById('inviteModal');
  const btnCloseInviteModal = document.getElementById('btnCloseInviteModal');
  const modalKeyInput = document.getElementById('modalKeyInput');
  const modalLinkInput = document.getElementById('modalLinkInput');
  const btnModalCopyKey = document.getElementById('btnModalCopyKey');
  const btnModalCopyLink = document.getElementById('btnModalCopyLink');
  const btnCopyInviteAll = document.getElementById('btnCopyInviteAll');
  const qrCodeWrapper = document.getElementById('qrCodeWrapper');
  const toastContainer = document.getElementById('toastContainer');

  // ==========================================================================
  // Initialization & URL Param Parsing
  // ==========================================================================
  
  // Theme init
  const savedTheme = localStorage.getItem('keychat_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Restore Nickname & Color Swatch
  if (currentProfile.nickname) {
    inputNickname.value = currentProfile.nickname;
  }
  setupColorSwatches();

  // Check URL query parameters for ?key=... or #...
  const urlParams = new URLSearchParams(window.location.search);
  const keyFromUrl = urlParams.get('key') || window.location.hash.replace('#', '');
  if (keyFromUrl) {
    inputSharedKey.value = keyFromUrl;
    inputSharedKey.type = 'text';
  }

  // ==========================================================================
  // Entry Form Handlers
  // ==========================================================================

  btnRandomKey.addEventListener('click', () => {
    inputSharedKey.value = CryptoManager.generateFriendlyKey();
    inputSharedKey.type = 'text';
    inputSharedKey.focus();
  });

  btnToggleKeyVisibility.addEventListener('click', () => {
    inputSharedKey.type = inputSharedKey.type === 'password' ? 'text' : 'password';
  });

  function setupColorSwatches() {
    const swatches = colorSwatches.querySelectorAll('.color-swatch');
    swatches.forEach(swatch => {
      if (swatch.getAttribute('data-color') === currentProfile.avatarColor) {
        swatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      }
      swatch.addEventListener('click', () => {
        swatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        currentProfile.avatarColor = swatch.getAttribute('data-color');
        localStorage.setItem('keychat_color', currentProfile.avatarColor);
      });
    });
  }

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const keyVal = inputSharedKey.value.trim();
    const nameVal = inputNickname.value.trim() || 'Anonymous';

    if (!keyVal) {
      showToast('Please enter a shared key');
      return;
    }

    currentKey = keyVal;
    currentProfile.nickname = nameVal;
    localStorage.setItem('keychat_nickname', nameVal);

    // Update UI profile
    myAvatarMini.textContent = nameVal.charAt(0).toUpperCase();
    myAvatarMini.style.backgroundColor = currentProfile.avatarColor;
    myNameMini.textContent = nameVal;
    sidebarKeyText.textContent = keyVal;
    headerRoomTitle.textContent = `Room: ${keyVal.length > 18 ? keyVal.substring(0, 16) + '...' : keyVal}`;
    
    const derivedRoom = await CryptoManager.deriveRoomId(keyVal);
    badgeRoomId.textContent = `#${derivedRoom.substring(0, 6)}`;

    // Join P2P Mesh
    await p2pManager.joinRoom(currentKey, currentProfile);

    // Hide entry modal
    entryContainer.classList.add('hidden');
    chatInput.focus();

    showToast('Secure room connected with E2EE 🔒');
  });

  // ==========================================================================
  // Network Callbacks
  // ==========================================================================

  p2pManager.onStatusChanged = (statusMsg, isConnected) => {
    statusText.textContent = statusMsg;
    if (isConnected) {
      statusDot.className = 'status-dot connected';
    } else {
      statusDot.className = 'status-dot connecting';
    }
  };

  p2pManager.onPeersUpdated = (peers) => {
    peersCountBadge.textContent = peers.length;
    peerList.innerHTML = '';

    peers.forEach(peer => {
      const li = document.createElement('li');
      li.className = 'peer-item';

      const initial = (peer.nickname || 'A').charAt(0).toUpperCase();
      const youTag = peer.isMe ? '<span class="you-tag">You</span>' : '';
      const hostTag = peer.isHost ? '<span class="host-tag">Host</span>' : '';

      li.innerHTML = `
        <div class="peer-avatar" style="background-color: ${peer.avatarColor || '#6366f1'}">${initial}</div>
        <div class="peer-details">
          <div class="peer-name">
            <span>${escapeHTML(peer.nickname)}</span>
            ${youTag}
            ${hostTag}
          </div>
          <div class="peer-status-sub">${peer.isMe ? 'This Device' : 'Connected Peer'}</div>
        </div>
      `;
      peerList.appendChild(li);
    });
  };

  p2pManager.onMessageReceived = (msg) => {
    appendMessage(msg, false);
  };

  let typingHideTimer = null;
  p2pManager.onTypingIndicator = (sender, isTyping) => {
    if (isTyping) {
      typingText.textContent = `${sender} is typing...`;
      typingIndicator.style.visibility = 'visible';
      if (typingHideTimer) clearTimeout(typingHideTimer);
      typingHideTimer = setTimeout(() => {
        typingIndicator.style.visibility = 'hidden';
      }, 3000);
    } else {
      typingIndicator.style.visibility = 'hidden';
    }
  };

  // ==========================================================================
  // Chat Messaging Handlers
  // ==========================================================================

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSendMessage();
  });

  chatInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await handleSendMessage();
    }
  });

  // Typing event emission
  chatInput.addEventListener('input', () => {
    // Auto-resize
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';

    p2pManager.sendTyping(true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      p2pManager.sendTyping(false);
    }, 1500);
  });

  async function handleSendMessage() {
    const text = chatInput.value.trim();
    if (!text && !pendingAttachment) return;

    const attachments = pendingAttachment ? [pendingAttachment] : [];
    
    // Clear input immediately for smooth UX
    chatInput.value = '';
    chatInput.style.height = 'auto';
    clearAttachment();

    try {
      const msgObj = await p2pManager.sendMessage(text, attachments);
      appendMessage(msgObj, true);
    } catch (err) {
      console.error('Send error:', err);
      showToast('Failed to send message');
    }
  }

  function appendMessage(msg, isMe) {
    const row = document.createElement('div');
    row.className = `message-row ${isMe ? 'outgoing' : 'incoming'}`;

    const initial = (msg.sender || 'A').charAt(0).toUpperCase();
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      msg.attachments.forEach(att => {
        if (att.type.startsWith('image/')) {
          attachmentsHtml += `<img src="${att.data}" alt="${escapeHTML(att.name)}" onclick="window.open('${att.data}', '_blank')">`;
        }
      });
    }

    const formattedText = formatMessageText(msg.text);

    row.innerHTML = `
      <div class="message-avatar" style="background-color: ${msg.avatarColor || '#6366f1'}">${initial}</div>
      <div class="message-content-wrapper">
        <div class="message-meta">
          <span class="message-sender">${escapeHTML(msg.sender)}</span>
          <span>${timeStr}</span>
        </div>
        <div class="message-bubble">
          ${formattedText ? `<div>${formattedText}</div>` : ''}
          ${attachmentsHtml}
        </div>
        <div class="message-footer">
          <svg class="e2ee-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>E2EE Encrypted</span>
        </div>
      </div>
    `;

    messagesContainer.appendChild(row);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function formatMessageText(text) {
    if (!text) return '';
    let formatted = escapeHTML(text);
    
    // Bold: **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Inline code: `code`
    formatted = formatted.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 5px; border-radius: 4px; font-family: monospace;">$1</code>');
    // URLs to links
    formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">$1</a>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
  }

  // ==========================================================================
  // Image Attachment Handling
  // ==========================================================================

  btnAttachImage.addEventListener('click', () => {
    imageFileInput.click();
  });

  imageFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      showToast('Image must be under 8MB');
      return;
    }

    // Scale image before sending over P2P
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1200;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);

        pendingAttachment = {
          name: file.name,
          type: 'image/jpeg',
          data: compressedDataUrl
        };

        attachmentThumb.src = compressedDataUrl;
        attachmentInfo.textContent = file.name;
        attachmentPreviewBar.classList.add('active');
        chatInput.focus();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    imageFileInput.value = '';
  });

  btnRemoveAttachment.addEventListener('click', () => {
    clearAttachment();
  });

  function clearAttachment() {
    pendingAttachment = null;
    attachmentPreviewBar.classList.remove('active');
    attachmentThumb.src = '';
  }

  // ==========================================================================
  // Sidebar & Modals
  // ==========================================================================

  btnOpenSidebar.addEventListener('click', () => {
    sidebar.classList.add('open');
  });

  btnCloseSidebar.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });

  btnToggleTheme.addEventListener('click', () => {
    const curr = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = curr === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('keychat_theme', next);
    showToast(`Switched to ${next} theme`);
  });

  btnToggleAudio.addEventListener('click', () => {
    const isMuted = soundEngine.toggleMute();
    showToast(isMuted ? 'Sound effects muted' : 'Sound effects unmuted');
  });

  btnClearChat.addEventListener('click', () => {
    if (confirm('Clear local chat history for this session?')) {
      const msgs = messagesContainer.querySelectorAll('.message-row, .system-notice');
      msgs.forEach(m => m.remove());
      showToast('Chat history cleared');
    }
  });

  btnLeaveRoom.addEventListener('click', () => {
    if (confirm('Leave this shared room?')) {
      p2pManager.leave();
      entryContainer.classList.remove('hidden');
      messagesContainer.innerHTML = `
        <div class="room-welcome-banner">
          <div class="welcome-icon-shield">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h3 class="welcome-title">Zero-Knowledge Encrypted Channel</h3>
          <p class="welcome-desc">
            All messages, images, and typing events are encrypted using <strong>AES-256-GCM</strong> directly on your device. Only peers with your exact shared key can read them.
          </p>
        </div>
      `;
    }
  });

  // Invite & QR Code Modal
  btnOpenInviteModal.addEventListener('click', () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?key=${encodeURIComponent(currentKey)}`;
    
    modalKeyInput.value = currentKey;
    modalLinkInput.value = inviteUrl;

    // Render QR Code
    qrCodeWrapper.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      try {
        qrCodeInstance = new QRCode(qrCodeWrapper, {
          text: inviteUrl,
          width: 180,
          height: 180,
          colorDark: '#09090b',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.warn('QRCode render error:', e);
      }
    }

    inviteModal.classList.add('active');
  });

  btnCloseInviteModal.addEventListener('click', () => {
    inviteModal.classList.remove('active');
  });

  inviteModal.addEventListener('click', (e) => {
    if (e.target === inviteModal) {
      inviteModal.classList.remove('active');
    }
  });

  // Copy Actions
  btnSidebarCopyKey.addEventListener('click', () => copyToClipboard(currentKey, 'Shared Key copied to clipboard!'));
  btnModalCopyKey.addEventListener('click', () => copyToClipboard(currentKey, 'Shared Key copied!'));
  btnModalCopyLink.addEventListener('click', () => copyToClipboard(modalLinkInput.value, 'Invite link copied!'));
  btnCopyInviteAll.addEventListener('click', () => copyToClipboard(modalLinkInput.value, 'Invite link copied! Share with your friend to connect.'));

  // ==========================================================================
  // Helper Utilities
  // ==========================================================================

  function copyToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(successMsg))
        .catch(() => fallbackCopy(text, successMsg));
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast(successMsg);
    } catch (err) {
      showToast('Could not copy automatically');
    }
    document.body.removeChild(textarea);
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
      <span>${escapeHTML(message)}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  function escapeHTML(str) {
    if (!str) return '';
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
  }
});
