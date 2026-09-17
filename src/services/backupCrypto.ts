/**
 * Locking a backup file with a passphrase the user chooses.
 *
 * The database on the device is the only copy of someone's ledger, so the
 * backup is the one artefact that leaves it — a downloads folder, a mail
 * attachment, a synced drive. Anyone holding that file can read every
 * transaction in it, and there is no server to revoke anything.
 *
 * The passphrase is not restricted in any way: no minimum length, no required
 * mixture, no forbidden patterns. Rules like those push people toward the
 * shortest thing that satisfies them, and the app is in no position to judge
 * what someone can remember. What it can do is say plainly that a short
 * passphrase is quick to guess offline, and that a forgotten one cannot be
 * recovered by anybody.
 */

/** "SMBK" + format version, so a plain .db is never mistaken for one of these. */
const MAGIC = new Uint8Array([0x53, 0x4d, 0x42, 0x4b, 0x31]); // SMBK1
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

/**
 * Deliberately slow, and recorded in the file so it can be raised later
 * without stranding backups already written. Measured at roughly a third of a
 * second on a desktop — worth it for something done once per backup.
 */
const ITERATIONS = 600_000;

const HEADER_BYTES = MAGIC.length + 4 + SALT_BYTES + IV_BYTES;

export class BackupPassphraseWrong extends Error {
  constructor() {
    super(
      "암호가 맞지 않거나 파일이 손상되었습니다. 암호를 다시 확인해주세요."
    );
    this.name = "BackupPassphraseWrong";
  }
}

export class BackupNotEncrypted extends Error {
  constructor() {
    super("암호화된 백업 파일이 아닙니다.");
    this.name = "BackupNotEncrypted";
  }
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) {
    /*
      WebCrypto only exists in a secure context. Saying so beats failing with
      "undefined is not an object" — the same note as pinCrypto.
    */
    throw new Error(
      "이 브라우저에서는 암호화를 쓸 수 없습니다. https 또는 localhost 로 접속해주세요."
    );
  }
  return api;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Whether these bytes are one of our locked backups. */
export function isEncryptedBackup(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_BYTES) return false;
  return MAGIC.every((byte, index) => bytes[index] === byte);
}

export function backupIterations(bytes: Uint8Array): number | null {
  if (!isEncryptedBackup(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.length, 4);
  return view.getUint32(0, false);
}

/**
 * Wraps the database bytes so only this passphrase opens them.
 *
 * AES-GCM rather than plain AES: it authenticates as well as encrypts, so a
 * wrong passphrase or a damaged file fails outright instead of handing back
 * plausible rubbish. Opening rubbish as a database is exactly the accident
 * 4.6 guards against.
 */
export async function encryptBackup(
  bytes: Uint8Array,
  passphrase: string
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, ITERATIONS);

  const sealed = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      bytes as BufferSource
    )
  );

  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  let at = 0;
  out.set(MAGIC, at);
  at += MAGIC.length;
  new DataView(out.buffer).setUint32(at, ITERATIONS, false);
  at += 4;
  out.set(salt, at);
  at += SALT_BYTES;
  out.set(iv, at);
  at += IV_BYTES;
  out.set(sealed, at);

  return out;
}

/** The database bytes back, or a clear refusal. */
export async function decryptBackup(
  container: Uint8Array,
  passphrase: string
): Promise<Uint8Array> {
  if (!isEncryptedBackup(container)) throw new BackupNotEncrypted();

  let at = MAGIC.length;
  const iterations = new DataView(
    container.buffer,
    container.byteOffset + at,
    4
  ).getUint32(0, false);
  at += 4;

  // A file claiming an absurd cost would otherwise hang the tab
  if (iterations < 1 || iterations > 5_000_000) throw new BackupPassphraseWrong();

  const salt = container.slice(at, at + SALT_BYTES);
  at += SALT_BYTES;
  const iv = container.slice(at, at + IV_BYTES);
  at += IV_BYTES;
  const sealed = container.slice(at);

  const key = await deriveKey(passphrase, salt, iterations);

  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        sealed as BufferSource
      )
    );
  } catch {
    // GCM cannot tell a wrong key from a changed byte, and both mean "no"
    throw new BackupPassphraseWrong();
  }
}

/**
 * Rough advice on a passphrase, shown as the user types — never a gate.
 *
 * It counts what an attacker has to get through, not whether a rule was
 * followed: how many distinct characters are in play, over how many
 * positions. The one thing worth telling someone is that a six-digit number
 * is a million guesses and a few words are not.
 */
export function passphraseAdvice(passphrase: string): {
  level: "NONE" | "WEAK" | "FAIR" | "STRONG";
  text: string;
} {
  const value = passphrase || "";
  if (value.length === 0) {
    return { level: "NONE", text: "암호를 입력하면 이 파일은 그 암호로만 열립니다." };
  }

  let alphabet = 0;
  if (/[0-9]/.test(value)) alphabet += 10;
  if (/[a-z]/.test(value)) alphabet += 26;
  if (/[A-Z]/.test(value)) alphabet += 26;
  if (/[가-힣]/.test(value)) alphabet += 2_350;
  if (/[^0-9a-zA-Z가-힣]/.test(value)) alphabet += 32;

  // log2(alphabet^length) — the usual rough count, in bits
  const bits = value.length * Math.log2(Math.max(alphabet, 2));

  if (bits < 30) {
    return {
      level: "WEAK",
      text: "짧습니다. 파일을 가져간 사람은 시간 제한 없이 대입해볼 수 있어, 이 정도는 금방 풀립니다.",
    };
  }
  if (bits < 60) {
    return {
      level: "FAIR",
      text: "쓸 만합니다. 더 길게 하거나 단어를 하나 더 붙이면 훨씬 강해집니다.",
    };
  }
  return { level: "STRONG", text: "충분히 깁니다. 잊지 않도록 따로 적어 두세요." };
}
