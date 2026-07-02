import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import { verifyAppleIdToken } from "../core/oauth2.ts";

const ISSUER = "https://appleid.apple.com";
const CLIENT_ID = "com.example.app";

/** Wrap a public key as the key-resolver `verifyAppleIdToken` expects. */
function keyGetter(pub: jose.KeyLike): jose.JWTVerifyGetKey {
  return async () => pub;
}

interface TokenOpts {
  iss?: string;
  aud?: string;
  expOffsetS?: number;
}

async function signToken(
  priv: jose.KeyLike,
  claims: Record<string, unknown>,
  opts: TokenOpts = {},
): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  return await new jose.SignJWT({ email: "user@example.com", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + (opts.expOffsetS ?? 300))
    .sign(priv);
}

describe("verifyAppleIdToken", () => {
  it("accepts a properly-signed token and returns claims", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
    const token = await signToken(privateKey, { sub: "sub-1", email: "x@y.com" });
    const claims = await verifyAppleIdToken(token, CLIENT_ID, keyGetter(publicKey));
    expect(claims.sub).toBe("sub-1");
    expect(claims.email).toBe("x@y.com");
  });

  it("rejects a wrong audience", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
    const token = await signToken(privateKey, { sub: "s" }, { aud: "com.attacker.app" });
    await expect(verifyAppleIdToken(token, CLIENT_ID, keyGetter(publicKey))).rejects.toThrow();
  });

  it("rejects a wrong issuer", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
    const token = await signToken(privateKey, { sub: "s" }, { iss: "https://evil.example.com" });
    await expect(verifyAppleIdToken(token, CLIENT_ID, keyGetter(publicKey))).rejects.toThrow();
  });

  it("rejects a token signed by a different key (forged signature)", async () => {
    const signer = await jose.generateKeyPair("ES256");
    const other = await jose.generateKeyPair("ES256");
    const token = await signToken(signer.privateKey, { sub: "s" });
    await expect(
      verifyAppleIdToken(token, CLIENT_ID, keyGetter(other.publicKey)),
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
    const token = await signToken(privateKey, { sub: "s" }, { expOffsetS: -60 });
    await expect(verifyAppleIdToken(token, CLIENT_ID, keyGetter(publicKey))).rejects.toThrow();
  });
});
