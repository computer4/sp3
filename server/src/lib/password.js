import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended parameters. Plaintext passwords are never stored or logged.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain) {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(passwordHash, plain) {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
