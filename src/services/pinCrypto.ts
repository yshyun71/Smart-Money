/**
 * PIN storage.
 *
 * The PIN is never kept in a readable form — not in the database, not in
 * localStorage. It is stretched with PBKDF2-HMAC-SHA256 over a per-device
 * random salt, and only the derived bytes are stored. Checking a PIN derives
 * again and compares; there is nothing to read back.
 *
 * The iteration count travels with the stored hash, so it can be raised later
 * without invalidating PINs already registered on a device.
 */

const ITERATIONS = 310_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

export interface StoredPin {
  hash: string; // base64
  salt: string; // base64
  iterations: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  return new Uint8Array(bits);
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function hashPin(pin: string): Promise<StoredPin> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(pin, salt, ITERATIONS);

  return {
    hash: toBase64(derived),
    salt: toBase64(salt),
    iterations: ITERATIONS,
  };
}

/** Compares without leaking how many leading bytes matched. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function checkPin(pin: string, stored: StoredPin): Promise<boolean> {
  try {
    const derived = await derive(pin, fromBase64(stored.salt), stored.iterations);
    return equalBytes(derived, fromBase64(stored.hash));
  } catch (error) {
    console.error("PIN 확인 중 오류가 발생했습니다:", error);
    return false;
  }
}
