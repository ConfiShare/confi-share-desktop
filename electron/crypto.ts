import crypto from 'node:crypto';

/**
 * Derives a wrapping key from a passkey using PBKDF2.
 * Matches the backend implementation exactly.
 */
export function deriveKeyFromPass(passKey: string, salt: string): Buffer {
  const saltBuffer = Buffer.from(salt, 'base64');
  return crypto.pbkdf2Sync(passKey, saltBuffer, 100000, 32, 'sha256');
}

/**
 * Unwraps (decrypts) the content-encryption key using the derived wrapping key.
 * Supports multiple wrapped-key payload shapes used by different backend builds.
 */
export function unwrapKeyWithPass(wrappedData: unknown, derivedKey: Buffer): Buffer {
  try {
    const obj = typeof wrappedData === 'string' ? JSON.parse(wrappedData) : wrappedData;
    if (typeof obj !== 'object' || obj === null) {
      throw new Error('Invalid wrappedKey structure');
    }

    const wrappedObj = obj as Record<string, unknown>;
    const ivValue = typeof wrappedObj.iv === 'string' ? wrappedObj.iv : wrappedObj.wrappedIv;
    const tagValue = typeof wrappedObj.tag === 'string' ? wrappedObj.tag : wrappedObj.authTag;
    const wrappedValue =
      typeof wrappedObj.wrapped === 'string'
        ? wrappedObj.wrapped
        : typeof wrappedObj.ciphertext === 'string'
          ? wrappedObj.ciphertext
          : wrappedObj.encryptedKey;

    if (typeof ivValue !== 'string' || typeof tagValue !== 'string' || typeof wrappedValue !== 'string') {
      throw new Error('Invalid wrappedKey fields');
    }

    const iv = Buffer.from(ivValue, 'base64');
    const tag = Buffer.from(tagValue, 'base64');
    const wrapped = Buffer.from(wrappedValue, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown unwrap error';
    console.error('unwrapKeyWithPass failed:', message);
    throw err;
  }
}

/**
 * Decrypts data using AES-256-GCM.
 */
export function aesGcmDecrypt(encryptedData: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown decrypt error';
    console.error('aesGcmDecrypt failed:', message);
    throw err;
  }
}

/**
 * Fully decrypts a .cdc container using a passKey.
 * Returns an object containing the JSON string and the recovered content key (base64).
 */
export async function decryptCDCContainer(
  container: unknown,
  passKey: string
): Promise<{ decryptedPayload: string; contentKey: string }> {
  if (typeof container !== 'object' || container === null) {
    throw new Error('Invalid container format');
  }

  const containerObj = container as Record<string, unknown>;
  const metaValue = containerObj.meta;
  if (typeof metaValue !== 'object' || metaValue === null) {
    throw new Error('Invalid container metadata');
  }

  const meta = metaValue as Record<string, unknown>;
  const payloadValue = containerObj.payload;
  if (typeof payloadValue !== 'string') {
    throw new Error('Invalid container payload');
  }

  if (typeof meta.iv !== 'string' || typeof meta.tag !== 'string') {
    throw new Error('Invalid container crypto metadata');
  }

  const passKeyHash = crypto.createHash('sha256').update(passKey).digest('hex');
  const saltString = typeof meta.salt === 'string' ? meta.salt : String(meta.salt ?? '');
  const saltBase64 = Buffer.from(saltString, 'base64');
  const saltBase64Url = Buffer.from(saltString, 'base64url');

  const variations: Array<{ name: string; p: string; s: string | Buffer }> = [
    { name: 'Raw PassKey + String Salt', p: passKey, s: saltString },
    { name: 'Raw PassKey + Base64 Salt', p: passKey, s: saltBase64 },
    { name: 'Raw PassKey + Base64url Salt', p: passKey, s: saltBase64Url },
    { name: 'Hashed PassKey + String Salt', p: passKeyHash, s: saltString },
    { name: 'Hashed PassKey + Base64 Salt', p: passKeyHash, s: saltBase64 },
    { name: 'Hashed PassKey + Base64url Salt', p: passKeyHash, s: saltBase64Url },
  ];

  let lastError: unknown = null;

  for (const variation of variations) {
    try {
      const derivedKey = crypto.pbkdf2Sync(variation.p, variation.s, 100000, 32, 'sha256');
      const contentKey = unwrapKeyWithPass(meta.wrappedKey, derivedKey);

      const fileIv = Buffer.from(meta.iv, 'base64');
      const fileTag = Buffer.from(meta.tag, 'base64');
      const encryptedPayload = Buffer.from(payloadValue, 'base64');
      const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);

      console.log(`Successfully decrypted using ${variation.name}`);

      return {
        decryptedPayload: decryptedBuffer.toString('utf8'),
        contentKey: contentKey.toString('base64'),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown variation error';
      console.error(`${variation.name} failed:`, message);
      lastError = error;
    }
  }

  const lastMessage = lastError instanceof Error ? lastError.message : 'Unknown decryption error';
  throw new Error(`Decryption failed: All variations failed. Last error: ${lastMessage}`);
}

/**
 * Decrypts the payload of a .cdc container using a previously recovered content key.
 * Used for offline viewing without requiring the passKey again.
 */
export async function decryptPayloadWithKey(
  container: unknown,
  contentKeyBase64: string
): Promise<string> {
  if (typeof container !== 'object' || container === null) {
    throw new Error('Invalid container format');
  }

  const containerObj = container as Record<string, unknown>;
  const metaValue = containerObj.meta;
  if (typeof metaValue !== 'object' || metaValue === null) {
    throw new Error('Invalid container metadata');
  }

  const meta = metaValue as Record<string, unknown>;
  const payloadValue = containerObj.payload;
  if (typeof payloadValue !== 'string') {
    throw new Error('Invalid container payload');
  }
  if (typeof meta.iv !== 'string' || typeof meta.tag !== 'string') {
    throw new Error('Invalid container crypto metadata');
  }

  const contentKey = Buffer.from(contentKeyBase64, 'base64');

  const fileIv = Buffer.from(meta.iv, 'base64');
  const fileTag = Buffer.from(meta.tag, 'base64');
  const encryptedPayload = Buffer.from(payloadValue, 'base64');

  const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
  return decryptedBuffer.toString('utf8');
}
