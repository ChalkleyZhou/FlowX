import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ENCRYPTION_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class CredentialCryptoService {
  encrypt(value: string) {
    const key = this.resolveMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTION_VERSION,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string) {
    const key = this.resolveMasterKey();
    const [version, ivValue, authTagValue, cipherTextValue] = payload.split(':');
    if (
      version !== ENCRYPTION_VERSION ||
      !ivValue?.trim() ||
      !authTagValue?.trim() ||
      !cipherTextValue?.trim()
    ) {
      throw new Error('Invalid credential payload format.');
    }

    const iv = Buffer.from(ivValue, 'base64');
    const authTag = Buffer.from(authTagValue, 'base64');
    const cipherText = Buffer.from(cipherTextValue, 'base64');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  }

  private resolveMasterKey() {
    const raw = process.env.FLOWX_CREDENTIAL_MASTER_KEY?.trim();
    if (!raw) {
      throw new Error(
        'FLOWX_CREDENTIAL_MASTER_KEY is required to use per-user credential encryption.',
      );
    }

    return createHash('sha256').update(raw, 'utf8').digest();
  }
}
