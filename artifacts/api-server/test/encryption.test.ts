import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "../src/lib/encryption";

describe("Token Encryption (AES-256-GCM)", () => {
  beforeAll(() => {
    // 32-byte base64 key
    process.env.TOKEN_ENCRYPTION_KEY = "kD4Cic+02uq1dNrqKV5oZBcZowqbyAnfOjhIo2Csx+Q=";
  });

  it("should successfully encrypt and decrypt a refresh token (round trip)", () => {
    const originalToken = "1//04test_refresh_token_xyz_1234567890_secret";
    const encrypted = encryptToken(originalToken);

    expect(encrypted).not.toBe(originalToken);
    expect(encrypted.split(":")).toHaveLength(3);

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(originalToken);
  });

  it("should fail when ciphertext is tampered with", () => {
    const originalToken = "1//04test_refresh_token_tamper_check";
    const encrypted = encryptToken(originalToken);

    const parts = encrypted.split(":");
    // Tamper with the ciphertext payload (last byte of part 3)
    const tamperedPayload =
      parts[2].slice(0, -2) + (parts[2].slice(-2) === "aa" ? "bb" : "aa");
    const tamperedEncrypted = `${parts[0]}:${parts[1]}:${tamperedPayload}`;

    expect(() => decryptToken(tamperedEncrypted)).toThrow();
  });

  it("should fail when authentication tag is tampered with", () => {
    const originalToken = "1//04test_refresh_token_tag_tamper";
    const encrypted = encryptToken(originalToken);

    const parts = encrypted.split(":");
    const tamperedTag =
      parts[1].slice(0, -2) + (parts[1].slice(-2) === "00" ? "ff" : "00");
    const tamperedEncrypted = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(() => decryptToken(tamperedEncrypted)).toThrow();
  });

  it("should fail when format or IV is invalid", () => {
    expect(() => decryptToken("invalid_string_without_colons")).toThrow(
      "Invalid encrypted token format",
    );
    expect(() => decryptToken("shortiv:shorttag:deadbeef")).toThrow(
      "Invalid IV or authentication tag length",
    );
  });
});

