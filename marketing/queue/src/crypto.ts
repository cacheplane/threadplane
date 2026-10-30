import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const KEY_ERROR = 'MARKETING_CREDENTIALS_KEY must be 32 bytes base64';

/** AES-256-GCM. Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>. */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function unseal(sealed: string, key: Buffer): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognized sealed credential format');
  }
  const [, iv, tag, ciphertext] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function loadCredentialKey(
  env: Record<string, string | undefined>
): Buffer {
  const key = Buffer.from(env['MARKETING_CREDENTIALS_KEY'] ?? '', 'base64');
  if (key.length !== 32) throw new Error(KEY_ERROR);
  return key;
}
