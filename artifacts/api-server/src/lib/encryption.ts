import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getEncryptionKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      "Missing TOKEN_ENCRYPTION_KEY environment variable. Must be a 32-byte base64 encoded string.",
    );
  }
  const keyBuf = Buffer.from(envKey, "base64");
  if (keyBuf.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be exactly 32 bytes when decoded (got ${keyBuf.length} bytes).`,
    );
  }
  return keyBuf;
}

/**
 * Encrypts a plaintext string (e.g. refresh token) using AES-256-GCM.
 * Output format: <iv-hex>:<auth-tag-hex>:<ciphertext-hex>
 */
export function encryptToken(plainText: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // standard 96-bit IV for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a ciphertext string created by encryptToken.
 * Throws if auth tag verification fails or ciphertext was tampered with.
 */
export function decryptToken(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivHex, tagHex, contentHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(contentHex, "hex");

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("Invalid IV or authentication tag length");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

