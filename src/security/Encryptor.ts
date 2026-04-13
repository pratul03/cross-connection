export interface EncryptedPayload {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function decodeBase64(input: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(input, "base64"));
  }

  if (typeof atob !== "undefined") {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error("No base64 decoder available in this runtime.");
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  if (typeof btoa !== "undefined") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  throw new Error("No base64 encoder available in this runtime.");
}

function parseKey(key: string): Uint8Array {
  const bytes = decodeBase64(key);
  if (bytes.length !== 32) {
    throw new Error("Invalid encryption key. Expected base64-encoded 32-byte key.");
  }
  return bytes;
}

function getCryptoRuntime(): Crypto {
  const runtimeCrypto = globalThis.crypto;
  if (!runtimeCrypto?.subtle) {
    throw new Error("WebCrypto is not available in this runtime.");
  }

  return runtimeCrypto;
}

export async function encryptJsonPayload(payload: unknown, encryptionKey: string): Promise<EncryptedPayload> {
  const runtimeCrypto = getCryptoRuntime();
  const key = parseKey(encryptionKey);
  const keyMaterial = Uint8Array.from(key);
  const iv = runtimeCrypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await runtimeCrypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload ?? null));
  const encrypted = new Uint8Array(
    await runtimeCrypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      cryptoKey,
      plaintext
    )
  );

  const tagLength = 16;
  const ciphertext = encrypted.slice(0, encrypted.length - tagLength);
  const tag = encrypted.slice(encrypted.length - tagLength);

  return {
    algorithm: "aes-256-gcm",
    iv: encodeBase64(iv),
    tag: encodeBase64(tag),
    ciphertext: encodeBase64(ciphertext)
  };
}
