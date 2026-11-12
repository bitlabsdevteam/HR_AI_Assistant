import { describe, expect, it } from "vitest";
import { verifyTelnyxWebhookSignature } from "../src/lib/signature";

function base64(value: ArrayBuffer): string {
  return Buffer.from(value).toString("base64");
}

async function signedRequest(rawBody: string, timestamp: string) {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const signedBytes = new TextEncoder().encode(`${timestamp}|${rawBody}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signedBytes);
  const publicKey = base64(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const headers = new Headers({
    "telnyx-signature-ed25519": base64(signature),
    "telnyx-timestamp": timestamp,
  });
  return { headers, publicKey };
}

describe("Telnyx webhook signature verification", () => {
  it("verifies the exact raw body and timestamp", async () => {
    const timestamp = "1762960000";
    const rawBody = '{"data":{"event_type":"assistant.initialization"}}';
    const { headers, publicKey } = await signedRequest(rawBody, timestamp);

    await expect(
      verifyTelnyxWebhookSignature({
        rawBody,
        headers,
        publicKey,
        nowSeconds: Number(timestamp),
      }),
    ).resolves.toBe(true);
  });

  it("rejects altered body bytes and stale timestamps", async () => {
    const timestamp = "1762960000";
    const rawBody = '{"data":{}}';
    const { headers, publicKey } = await signedRequest(rawBody, timestamp);

    await expect(
      verifyTelnyxWebhookSignature({
        rawBody: '{"data": {} }',
        headers,
        publicKey,
        nowSeconds: Number(timestamp),
      }),
    ).resolves.toBe(false);
    await expect(
      verifyTelnyxWebhookSignature({
        rawBody,
        headers,
        publicKey,
        nowSeconds: Number(timestamp) + 301,
      }),
    ).resolves.toBe(false);
  });
});
