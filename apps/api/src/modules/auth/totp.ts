import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
    return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, at: Date = new Date()): string {
    const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
    return hotp(secret, counter);
}

export function verifyTotp(secret: string, code: string, at: Date = new Date()): boolean {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
        return false;
    }
    const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
    for (const offset of [-1, 0, 1]) {
        const expected = hotp(secret, counter + offset);
        if (safeEqual(expected, trimmed)) {
            return true;
        }
    }
    return false;
}

export function otpauthUrl(input: { secret: string; email: string; issuer?: string }): string {
    const issuer = encodeURIComponent(input.issuer ?? "CoreMap");
    const label = encodeURIComponent(`CoreMap:${input.email}`);
    return `otpauth://totp/${label}?secret=${input.secret}&issuer=${issuer}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function hotp(secret: string, counter: number): string {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter & 0xffffffff, 4);
    const hmac = createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const bin =
        ((hmac[offset]! & 0x7f) << 24) |
        ((hmac[offset + 1]! & 0xff) << 16) |
        ((hmac[offset + 2]! & 0xff) << 8) |
        (hmac[offset + 3]! & 0xff);
    const otp = bin % 10 ** DIGITS;
    return otp.toString().padStart(DIGITS, "0");
}

function safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function base32Encode(buffer: Buffer): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 31];
    }
    return output;
}

function base32Decode(input: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const cleaned = input.toUpperCase().replace(/=+$/g, "");
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const char of cleaned) {
        const idx = alphabet.indexOf(char);
        if (idx < 0) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}
