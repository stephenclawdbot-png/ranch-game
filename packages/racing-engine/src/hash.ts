import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

const SEED_RE = /^[0-9a-f]{64}$/;

export function assertSeedHex(seedHex: string): void {
  if (typeof seedHex !== "string" || !SEED_RE.test(seedHex)) {
    throw new Error("seed must be 64 lowercase hex characters (32 bytes)");
  }
}

/** sha256 over the 32 raw seed bytes, as lowercase hex. Publish this before the race. */
export function commitSeed(seedHex: string): string {
  assertSeedHex(seedHex);
  return bytesToHex(sha256(hexToBytes(seedHex)));
}

/** HMAC-SHA256(secret, label) as lowercase hex. Used to derive per-race seeds statelessly. */
export function deriveSeed(secret: string, label: string): string {
  if (typeof secret !== "string" || secret.length === 0) throw new Error("deriveSeed: secret must be a non-empty string");
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(label)));
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** sha256(seed bytes || "tb-stream" || u16 key || u8 purpose) -> 32 bytes. */
export function streamSeedBytes(seedHex: string, key: number, purpose: number): Uint8Array {
  const seed = hexToBytes(seedHex);
  const tag = utf8ToBytes("tb-stream");
  const buf = new Uint8Array(seed.length + tag.length + 3);
  buf.set(seed, 0);
  buf.set(tag, seed.length);
  buf[seed.length + tag.length] = (key >>> 8) & 0xff;
  buf[seed.length + tag.length + 1] = key & 0xff;
  buf[seed.length + tag.length + 2] = purpose & 0xff;
  return sha256(buf);
}
