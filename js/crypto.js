/**
 * KeyChat - Web Crypto API Manager
 * End-to-End Encryption (AES-GCM-256) & Deterministic Room Key Derivation (PBKDF2 / SHA-256)
 */

class CryptoManager {
  constructor() {
    this.keyCache = new Map();
  }

  /**
   * Generates a human-friendly random shared key
   */
  static generateFriendlyKey() {
    const adjectives = [
      'amber', 'azure', 'bright', 'calm', 'cosmic', 'crimson', 'crystal',
      'daring', 'echo', 'emerald', 'frost', 'golden', 'hyper', 'lunar',
      'mystic', 'neon', 'nova', 'ocean', 'prism', 'quantum', 'radiant',
      'ruby', 'shadow', 'silent', 'silver', 'solar', 'sonic', 'stellar',
      'swift', 'vibrant', 'violet', 'zenith'
    ];
    const nouns = [
      'aurora', 'beacon', 'breeze', 'canyon', 'cascade', 'comet', 'drift',
      'falcon', 'flame', 'forest', 'glacier', 'harbor', 'horizon', 'island',
      'matrix', 'meadow', 'nebula', 'oasis', 'orbit', 'peak', 'phoenix',
      'pulse', 'quest', 'ridge', 'river', 'sanctuary', 'summit', 'tide',
      'valley', 'vessel', 'vortex', 'voyage'
    ];
    const num = Math.floor(1000 + Math.random() * 9000);
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj}-${noun}-${num}`;
  }

  /**
   * Hashes text using SHA-256
   * @param {string} text 
   * @returns {Promise<string>} Hex string
   */
  static async sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Derives a deterministic room ID for peer discovery from the shared key
   * We combine the shared key with a salt so the room discovery ID does not reveal the encryption key
   */
  static async deriveRoomId(sharedKey) {
    const salt = 'keychat-discovery-v1';
    const hash = await this.sha256(`${sharedKey.trim()}:${salt}`);
    return hash.substring(0, 16);
  }

  /**
   * Derives an AES-GCM 256-bit CryptoKey using PBKDF2
   * @param {string} sharedKey 
   * @returns {Promise<CryptoKey>}
   */
  async getEncryptionKey(sharedKey) {
    const trimmed = sharedKey.trim();
    if (this.keyCache.has(trimmed)) {
      return this.keyCache.get(trimmed);
    }

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(trimmed),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = encoder.encode('keychat-e2ee-aes-salt-v1');

    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    this.keyCache.set(trimmed, derivedKey);
    return derivedKey;
  }

  /**
   * Encrypts a JSON-serializable object using AES-GCM
   * @param {string} sharedKey 
   * @param {any} plainData 
   * @returns {Promise<{iv: string, cipher: string}>}
   */
  async encrypt(sharedKey, plainData) {
    const key = await this.getEncryptionKey(sharedKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encoded = encoder.encode(JSON.stringify(plainData));

    const cipherBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encoded
    );

    return {
      iv: this.arrayBufferToBase64(iv.buffer),
      cipher: this.arrayBufferToBase64(cipherBuffer)
    };
  }

  /**
   * Decrypts an encrypted payload using AES-GCM
   * @param {string} sharedKey 
   * @param {{iv: string, cipher: string}} payload 
   * @returns {Promise<any>}
   */
  async decrypt(sharedKey, payload) {
    try {
      const key = await this.getEncryptionKey(sharedKey);
      const iv = this.base64ToArrayBuffer(payload.iv);
      const cipherData = this.base64ToArrayBuffer(payload.cipher);

      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(iv)
        },
        key,
        cipherData
      );

      const decoder = new TextDecoder();
      const decodedStr = decoder.decode(decryptedBuffer);
      return JSON.parse(decodedStr);
    } catch (err) {
      console.error('Decryption failed. Shared key mismatch or corrupted payload:', err);
      throw new Error('Decryption failed');
    }
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

window.CryptoManager = CryptoManager;
