import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "v1";

export function encryptSecret(plain: string, keyMaterial: string): string {
    const key = deriveKey(keyMaterial);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(
        "."
    );
}

export function decryptSecret(payload: string, keyMaterial: string): string {
    const [prefix, ivB64, tagB64, dataB64] = payload.split(".");
    if (prefix !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
        throw new Error("Invalid encrypted MFA secret");
    }
    const key = deriveKey(keyMaterial);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64url")),
        decipher.final(),
    ]);
    return decrypted.toString("utf8");
}

function deriveKey(keyMaterial: string): Buffer {
    // Fixed application salt is acceptable only because AUTH_MFA_ENCRYPTION_KEY
    // must be a high-entropy random production secret (≥32 chars / prefer 32 random
    // bytes). Do not derive that key from passwords, JWT secrets, or the app name.
    return scryptSync(keyMaterial, "coremap-mfa-v1", 32);
}
