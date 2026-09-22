// Password hashing uses salted PBKDF2-SHA256 (210,000 iterations) — appropriate for
// low-entropy, user-chosen secrets. Session tokens are high-entropy random values already,
// so they use a fast unsalted SHA-256 (hashToken) instead: running PBKDF2 on every single
// authenticated API request would add hundreds of milliseconds to every call.

const PBKDF2_ITERATIONS = 210000;

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

async function legacySha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(digest);
}

/** Hash a password for storage. Returns "pbkdf2$<iterations>$<saltHex>$<hashHex>". */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

/** True if a stored hash predates this scheme (plain unsalted SHA-256 hex, 64 chars). */
export function isLegacyHash(stored) {
  return !!stored && !stored.startsWith('pbkdf2$');
}

/** Verify a password against a stored hash, transparently supporting legacy hashes. */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (isLegacyHash(stored)) {
    const computed = await legacySha256Hex(password);
    return timingSafeEqual(computed, stored);
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromHex(parts[2]);
  const derived = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(toHex(derived), parts[3]);
}

/** Fast hash for opaque, high-entropy session tokens (not for passwords). */
export async function hashToken(token) {
  return legacySha256Hex(token);
}
