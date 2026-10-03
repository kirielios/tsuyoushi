// Port of keiyoushi/extensions-source src/en/hentainexus/Utils.kt
import { Base64 } from "../../../sdk/index.ts";

const primeNumbers = [2, 3, 5, 7, 11, 13, 17, 19];

// XOR polynomial mask used in the CRC-like prime-index derivation step.
const PRIME_IDX_XOR_MASK = 12;

export function decryptData(encoded: string): string {
  return decryptBytes(Base64.decode(encoded));
}

function decryptBytes(data: Uint8Array): string {
  const hostname = "hentainexus.com";

  for (let i = 0; i < hostname.length; i++) data[i] = data[i] ^ hostname.charCodeAt(i);

  const keyStream = Array.from(data.slice(0, 64));
  const ciphertext = Array.from(data.slice(64));
  const digest = Array.from({ length: 256 }, (_, i) => i);

  let primeIdx = 0;
  for (let i = 0; i < 64; i++) {
    primeIdx = primeIdx ^ keyStream[i];

    for (let j = 0; j < 8; j++) primeIdx = (primeIdx & 1) !== 0 ? (primeIdx >>> 1) ^ PRIME_IDX_XOR_MASK : primeIdx >>> 1;
  }
  primeIdx = primeIdx & 7;

  let temp: number;
  let key = 0;
  for (let i = 0; i <= 255; i++) {
    key = (key + digest[i] + keyStream[i % 64]) % 256;

    temp = digest[i];
    digest[i] = digest[key];
    digest[key] = temp;
  }

  const q = primeNumbers[primeIdx];
  let k = 0;
  let n = 0;
  let p = 0;
  let xorKey = 0;
  // upstream appends (byte xor key).toChar(): one Latin-1 char per byte, not UTF-8 decoded
  let out = "";
  for (let i = 0; i < ciphertext.length; i++) {
    k = (k + q) % 256;
    n = (p + digest[(n + digest[k]) % 256]) % 256;
    p = (p + k + digest[k]) % 256;

    temp = digest[k];
    digest[k] = digest[n];
    digest[n] = temp;

    xorKey = digest[(n + digest[(k + digest[(xorKey + p) % 256]) % 256]) % 256];
    out += String.fromCharCode(ciphertext[i] ^ xorKey);
  }
  return out;
}
