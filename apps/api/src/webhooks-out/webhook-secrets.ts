import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { parseKey, SecretBox } from '../integrations/crypto/secret-box';

/** Seals webhook signing secrets like integration credentials (AES-256-GCM, AAD per endpoint). */
@Injectable()
export class WebhookSecrets {
  private readonly box: SecretBox;

  constructor(@Inject(ENV) env: Env) {
    this.box = new SecretBox({ current: parseKey(env.APP_ENCRYPTION_KEY) });
  }

  seal(endpointId: string, secret: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.box.encrypt(secret, `webhook:${endpointId}`));
  }

  open(endpointId: string, blob: Uint8Array): string {
    return this.box.decrypt(blob, `webhook:${endpointId}`).toString('utf8');
  }
}
