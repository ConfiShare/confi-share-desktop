import crypto from 'node:crypto';

/**
 * Derives a wrapping key from a passkey using PBKDF2.
 * Matches the backend implementation exactly.
 */
export function deriveKeyFromPass(passKey: string, salt: string): Buffer {
  // salt is passed as a base64 string from the backend.
  // Converting it back to a Buffer before derivation.
  const saltBuffer = Buffer.from(salt, 'base64');
  return crypto.pbkdf2Sync(passKey, saltBuffer, 100000, 32, 'sha256');
}

/**
 * Unwraps (decrypts) the content-encryption key using the derived wrapping key.
 */
export function unwrapKeyWithPass(wrappedData: any, derivedKey: Buffer): Buffer {
  try {
    const obj = typeof wrappedData === 'string' ? JSON.parse(wrappedData) : wrappedData;
    const iv = Buffer.from(obj.iv, 'base64');
    const tag = Buffer.from(obj.tag, 'base64');
    const wrapped = Buffer.from(obj.wrapped, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);
    
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch (err: any) {
    console.error('unwrapKeyWithPass failed:', err.message);
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
  } catch (err: any) {
    console.error('aesGcmDecrypt failed:', err.message);
    throw err;
  }
}

/**
 * Fully decrypts a .cdc container using a passKey.
 * Returns an object containing the JSON string and the recovered content key (base64).
 */
export async function decryptCDCContainer(
  container: any, 
  passKey: string
): Promise<{ decryptedPayload: string; contentKey: string }> {
  const { meta } = container;
  const passKeyHash = crypto.createHash('sha256').update(passKey).digest('hex');
  
  // Diagnostic: Try combinations of salt and passKey transformations
  const variations = [
    { name: 'Raw PassKey + String Salt', p: passKey, s: meta.salt },
    { name: 'Raw PassKey + Buffer Salt', p: passKey, s: Buffer.from(meta.salt, 'base64') },
    { name: 'Hashed PassKey + String Salt', p: passKeyHash, s: meta.salt },
    { name: 'Hashed PassKey + Buffer Salt', p: passKeyHash, s: Buffer.from(meta.salt, 'base64') }
  ];

  let lastError: any = null;

  for (const v of variations) {
    try {
      // 1. Derive wrapping key
      const derivedKey = crypto.pbkdf2Sync(v.p, v.s, 100000, 32, 'sha256');
      
      // 2. Unwrap content key
      const contentKey = unwrapKeyWithPass(meta.wrappedKey, derivedKey);
      
      // 3. Decrypt payload
      const fileIv = Buffer.from(meta.iv, 'base64');
      const fileTag = Buffer.from(meta.tag, 'base64');
      const encryptedPayload = Buffer.from(container.payload, 'base64');
      
      const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
      
      console.log(`✅ Successfully decrypted using ${v.name}`);
      
      return {
        decryptedPayload: decryptedBuffer.toString('utf8'),
        contentKey: contentKey.toString('base64'),
      };
    } catch (error: any) {
      console.error(`❌ ${v.name} failed:`, error.message);
      lastError = error;
    }
  }

  throw new Error(`Decryption failed: All 4 variations failed. Check terminal logs for details.`);
}

/**
 * Decrypts the payload of a .cdc container using a previously recovered content key.
 * Used for offline viewing without requiring the passKey again.
 */
export async function decryptPayloadWithKey(
  container: any, 
  contentKeyBase64: string
): Promise<string> {
  const { meta, payload } = container;
  const contentKey = Buffer.from(contentKeyBase64, 'base64');
  
  const fileIv = Buffer.from(meta.iv, 'base64');
  const fileTag = Buffer.from(meta.tag, 'base64');
  const encryptedPayload = Buffer.from(payload, 'base64');
  
  const decryptedBuffer = aesGcmDecrypt(encryptedPayload, contentKey, fileIv, fileTag);
  return decryptedBuffer.toString('utf8');
}
