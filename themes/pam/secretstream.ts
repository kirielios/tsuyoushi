// Port of keiyoushi/extensions-source lib/secretstream (X25519.kt, ChaCha20.java, Core.java, Poly1305.java,
// SecretStream.java, State.java): libsodium's crypto_secretstream_xchacha20poly1305 pull side and X25519, the parts
// Pam needs. Written against the same standard algorithms (RFC 7748, RFC 8439, HChaCha20) rather than line by line.

// --- X25519 (RFC 7748), BigInt like upstream's BigInteger version
const P = (1n << 255n) - 19n;
const A24 = 121665n;
const mod = (a: bigint) => ((a % P) + P) % P;
function modPow(b: bigint, e: bigint): bigint {
  let r = 1n;
  b = mod(b);
  for (; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) r = (r * b) % P;
  return r;
}
const leToBig = (le: Uint8Array) => le.reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n);
function bigToLe(x: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++, x >>= 8n) out[i] = Number(x & 0xffn);
  return out;
}

export const X25519 = {
  publicKey(privateKey: Uint8Array): Uint8Array {
    const base = new Uint8Array(32);
    base[0] = 9;
    return X25519.scalarMult(privateKey, base);
  },
  scalarMult(scalar: Uint8Array, u: Uint8Array): Uint8Array {
    if (scalar.length !== 32) throw new Error("scalar must be 32 bytes");
    if (u.length !== 32) throw new Error("u must be 32 bytes");
    const s = scalar.slice();
    s[0] &= 248;
    s[31] = (s[31] & 127) | 64;
    const k = leToBig(s);
    const u2 = u.slice();
    u2[31] &= 127;
    const x1 = mod(leToBig(u2));
    let [x2, z2, x3, z3] = [1n, 0n, x1, 1n];
    let swap = 0n;
    for (let t = 254n; t >= 0n; t--) {
      const kt = (k >> t) & 1n;
      swap ^= kt;
      if (swap) [x2, x3, z2, z3] = [x3, x2, z3, z2];
      swap = kt;
      const a = mod(x2 + z2);
      const aa = (a * a) % P;
      const b = mod(x2 - z2);
      const bb = (b * b) % P;
      const e = mod(aa - bb);
      const c = mod(x3 + z3);
      const d = mod(x3 - z3);
      const da = (d * a) % P;
      const cb = (c * b) % P;
      x3 = mod((da + cb) * (da + cb));
      z3 = mod(x1 * mod((da - cb) * (da - cb)));
      x2 = (aa * bb) % P;
      z2 = mod(e * (aa + A24 * e));
    }
    if (swap) [x2, x3, z2, z3] = [x3, x2, z3, z2];
    return bigToLe(mod(x2 * modPow(z2, P - 2n)), 32);
  },
};

// --- ChaCha20 (RFC 8439)
const rotl = (v: number, n: number) => (v << n) | (v >>> (32 - n));
const load32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function rounds(x: Uint32Array) {
  const qr = (a: number, b: number, c: number, d: number) => {
    x[a] += x[b];
    x[d] = rotl(x[d] ^ x[a], 16);
    x[c] += x[d];
    x[b] = rotl(x[b] ^ x[c], 12);
    x[a] += x[b];
    x[d] = rotl(x[d] ^ x[a], 8);
    x[c] += x[d];
    x[b] = rotl(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12), qr(1, 5, 9, 13), qr(2, 6, 10, 14), qr(3, 7, 11, 15);
    qr(0, 5, 10, 15), qr(1, 6, 11, 12), qr(2, 7, 8, 13), qr(3, 4, 9, 14);
  }
}

/** HChaCha20(key, first 16 bytes of `input`) -> 32-byte subkey (Core.HCaCha20 with the default constants). */
export function hchacha20(input: Uint8Array, key: Uint8Array): Uint8Array {
  const x = new Uint32Array(16);
  x.set(SIGMA);
  for (let i = 0; i < 8; i++) x[4 + i] = load32(key, i * 4);
  for (let i = 0; i < 4; i++) x[12 + i] = load32(input, i * 4);
  rounds(x);
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((w, i) => dv.setUint32(i * 4, x[w], true));
  return out;
}

/** ChaCha20.streamIETFXorIC: `input` XOR the IETF keystream (12-byte nonce) starting at block `ic`. */
export function chacha20Xor(input: Uint8Array, nonce: Uint8Array, ic: number, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  const state = new Uint32Array(16);
  state.set(SIGMA);
  for (let i = 0; i < 8; i++) state[4 + i] = load32(key, i * 4);
  for (let i = 0; i < 3; i++) state[13 + i] = load32(nonce, i * 4);
  const x = new Uint32Array(16);
  const block = new Uint8Array(x.buffer);
  for (let pos = 0, counter = ic; pos < input.length; pos += 64, counter++) {
    state[12] = counter;
    x.set(state);
    rounds(x);
    for (let i = 0; i < 16; i++) x[i] += state[i];
    for (let i = 0; i < 64 && pos + i < input.length; i++) out[pos + i] = input[pos + i] ^ block[i];
  }
  return out;
}

// --- Poly1305 (RFC 8439), BigInt
function poly1305(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const r = leToBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leToBig(key.subarray(16, 32));
  const p = (1n << 130n) - 5n;
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const chunk = msg.subarray(i, i + 16);
    acc = ((acc + leToBig(chunk) + (1n << BigInt(8 * chunk.length))) * r) % p;
  }
  return bigToLe((acc + s) & ((1n << 128n) - 1n), 16);
}

// --- crypto_secretstream_xchacha20poly1305 (pull only)
export class State {
  k: Uint8Array = new Uint8Array(32);
  nonce: Uint8Array = new Uint8Array(12);
}

export class SecretStream {
  static readonly ABYTES = 17;
  static readonly TAG_MESSAGE = 0x00;
  static readonly TAG_PUSH = 0x01;
  static readonly TAG_REKEY = 0x02;
  static readonly TAG_FINAL = 0x03;

  initPull(state: State, header: Uint8Array, key: Uint8Array) {
    state.k = hchacha20(header, key);
    this.counterReset(state);
    state.nonce.set(header.subarray(16, 24), 4);
  }

  /** null when the message is too short or fails authentication. */
  pull(state: State, input: Uint8Array): { message: Uint8Array; tag: number } | null {
    if (input.length < SecretStream.ABYTES) return null;
    const mlen = input.length - SecretStream.ABYTES;
    const polyKey = chacha20Xor(new Uint8Array(64), state.nonce, 0, state.k).subarray(0, 32);

    const block = new Uint8Array(64);
    block[0] = input[0];
    const encBlock = chacha20Xor(block, state.nonce, 1, state.k);
    const tag = encBlock[0];
    const c = input.subarray(1, 1 + mlen);

    // encrypted block (its first byte the received one) | c | pad | le64(adlen = 0) | le64(64 + mlen)
    const padLen = (0x10 - 64 + mlen) & 0xf;
    const macData = new Uint8Array(64 + mlen + padLen + 16);
    macData.set(encBlock);
    macData[0] = input[0];
    macData.set(c, 64);
    const dv = new DataView(macData.buffer);
    dv.setBigUint64(64 + mlen + padLen + 8, BigInt(64 + mlen), true);
    const mac = poly1305(polyKey, macData);

    const stored = input.subarray(1 + mlen, 1 + mlen + 16);
    let diff = 0;
    for (let i = 0; i < 16; i++) diff |= mac[i] ^ stored[i];
    if (diff) return null;

    const m = chacha20Xor(c, state.nonce, 2, state.k);
    for (let i = 0; i < 8; i++) state.nonce[4 + i] ^= mac[i];
    // increment the 32-bit counter
    for (let i = 0; i < 4; i++) if (++state.nonce[i] !== 0) break;
    if (tag & SecretStream.TAG_REKEY || state.nonce.subarray(0, 4).every((b) => b === 0)) this.rekey(state);
    return { message: m, tag };
  }

  private counterReset(state: State) {
    state.nonce.fill(0, 0, 4);
    state.nonce[0] = 1;
  }

  private rekey(state: State) {
    const buf = new Uint8Array(40);
    buf.set(state.k);
    buf.set(state.nonce.subarray(4, 12), 32);
    const x = chacha20Xor(buf, state.nonce, 0, state.k);
    state.k = x.slice(0, 32);
    state.nonce.set(x.subarray(32, 40), 4);
    this.counterReset(state);
  }
}
