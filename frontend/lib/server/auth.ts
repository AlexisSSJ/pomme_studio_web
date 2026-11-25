import crypto from "crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

const globalForAuth = globalThis as unknown as {
  __pommeSigningKey?: Buffer;
};

function getSigningKey(): Buffer {
  const configured = process.env.SECRET_KEY?.trim();
  if (configured && configured.length > 0) {
    return crypto.createHash("sha256").update(configured).digest();
  }
  if (!globalForAuth.__pommeSigningKey) {
    globalForAuth.__pommeSigningKey = crypto.randomBytes(32);
  }
  return globalForAuth.__pommeSigningKey;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== SCRYPT_KEYLEN) {
    return false;
  }
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return crypto.timingSafeEqual(derived, expected);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

export function createAccessToken(userId: string): string {
  const rawMinutes = Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES);
  const expireMinutes =
    Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 480;
  const nowSec = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      iat: nowSec,
      exp: nowSec + Math.floor(expireMinutes * 60),
    })
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", getSigningKey())
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(sig)}`;
}

export function verifyAccessToken(token: string): { sub: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  const signingInput = `${header}.${payload}`;
  const expectedSig = crypto
    .createHmac("sha256", getSigningKey())
    .update(signingInput)
    .digest();

  let actualSig: Buffer;
  try {
    actualSig = base64UrlDecode(signature);
  } catch {
    return null;
  }

  if (actualSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return null;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload).toString("utf-8")) as {
      sub?: unknown;
      exp?: unknown;
    };
    if (typeof decoded.sub !== "string" || typeof decoded.exp !== "number") {
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (decoded.exp <= nowSec) {
      return null;
    }
    return { sub: decoded.sub };
  } catch {
    return null;
  }
}

export function generateTemporaryPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}
