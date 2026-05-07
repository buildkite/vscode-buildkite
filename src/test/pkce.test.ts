import * as assert from "node:assert/strict";
import {
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from "../api/oauth/pkce";

describe("pkce", () => {
  it("verifier is 43 base64url chars", () => {
    const v = generateCodeVerifier();
    assert.equal(v.length, 43);
    assert.match(v, /^[A-Za-z0-9_-]+$/);
  });

  it("state is base64url and shorter than the verifier", () => {
    const s = generateState();
    assert.match(s, /^[A-Za-z0-9_-]+$/);
    // 16 random bytes -> 22 chars
    assert.equal(s.length, 22);
  });

  it("verifier and state are random across calls", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    assert.notEqual(a, b);
    assert.notEqual(generateState(), generateState());
  });

  it("S256 challenge of a known verifier matches the documented value", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    assert.equal(codeChallengeFromVerifier(verifier), expected);
  });

  it("challenge is deterministic for a given verifier", () => {
    const v = generateCodeVerifier();
    assert.equal(codeChallengeFromVerifier(v), codeChallengeFromVerifier(v));
  });
});
