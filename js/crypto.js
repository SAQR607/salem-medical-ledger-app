// AES-256-GCM + PBKDF2 helpers built on WebCrypto (secure context required:
// GitHub Pages is https, localhost is fine; file:// will NOT work).
var Crypto = (function () {
  var ITERATIONS = 310000;

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // 32-byte key-encryption key derived from a password (login verifier is the
  // GCM auth tag itself: wrong password ⇒ decryption fails, no separate hash).
  async function deriveKek(password, saltB64) {
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations: ITERATIONS, hash: "SHA-256" },
      base,
      256
    );
    return new Uint8Array(bits);
  }

  async function importAes(rawBytes) {
    return crypto.subtle.importKey("raw", rawBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function encryptBytes(keyBytes, plainBytes) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await importAes(keyBytes);
    var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plainBytes);
    return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
  }

  async function decryptBytes(keyBytes, blob) {
    var key = await importAes(keyBytes);
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct));
    return new Uint8Array(pt);
  }

  async function encryptJson(keyBytes, obj) {
    return encryptBytes(keyBytes, new TextEncoder().encode(JSON.stringify(obj)));
  }

  async function decryptJson(keyBytes, blob) {
    var pt = await decryptBytes(keyBytes, blob);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  function randomB64(n) {
    return bytesToB64(randomBytes(n));
  }

  return {
    deriveKek: deriveKek,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
    encryptJson: encryptJson,
    decryptJson: decryptJson,
    randomBytes: randomBytes,
    randomB64: randomB64,
    b64ToBytes: b64ToBytes,
    bytesToB64: bytesToB64
  };
})();
