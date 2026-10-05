import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (docs/06 §13, §42).
 *
 * The parameters below are the library defaults, which docs/06 does not
 * override. `verify` is constant-time inside the library, and a failed verify
 * still performs the work so timing does not reveal whether the account exists.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password);
    } catch {
      // A malformed stored hash must not become a 500.
      return false;
    }
  }

  /**
   * Burns roughly the same time as a real verification. Called when the email
   * does not exist so that login timing cannot be used to enumerate accounts
   * (docs/06 §40).
   */
  async fakeVerify(): Promise<void> {
    await verify(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8pQeLPGxvHhHqXBLnMEWL8o0YcVXqXGwJ4FuVDGX1zY',
      'invalid-password-placeholder',
    ).catch(() => undefined);
  }
}
