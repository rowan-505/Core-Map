import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateTotpSecret, totpCode, verifyTotp } from "./totp.js";

describe("totp", () => {
    it("round-trips a current code", () => {
        const secret = generateTotpSecret();
        const code = totpCode(secret);
        assert.equal(verifyTotp(secret, code), true);
    });

    it("rejects a wrong code", () => {
        const secret = generateTotpSecret();
        assert.equal(verifyTotp(secret, "000000"), false);
    });
});
