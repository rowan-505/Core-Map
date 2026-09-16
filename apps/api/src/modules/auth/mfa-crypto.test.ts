import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decryptSecret, encryptSecret } from "./mfa-crypto.js";

describe("mfa crypto", () => {
    it("encrypts and decrypts a TOTP secret", () => {
        const secret = "JBSWY3DPEHPK3PXP";
        const packed = encryptSecret(secret, "test-mfa-key-material");
        assert.equal(decryptSecret(packed, "test-mfa-key-material"), secret);
        assert.notEqual(packed, secret);
    });
});
