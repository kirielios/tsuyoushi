// Port of keiyoushi/extensions-source lib/e4p/TiffDecoder.kt
// https://cs.opensource.google/go/x/image
// https://pkg.go.dev/golang.org/x/image/tiff/lzw

export class Argb8888 {
  constructor(
    readonly width: number,
    readonly height: number,
    /** 0xAARRGGBB per pixel */
    readonly pixels: Uint32Array,
  ) {}
}

// TIFF tags we care about
const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_PLANAR_CONFIG = 284;
const TAG_COLORMAP = 320;
const TAG_PREDICTOR = 317;

// TIFF field types
const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

const require = (cond: boolean, msg: () => string) => {
  if (!cond) throw new Error(msg());
};
export const readIntLE = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const readUShortLE = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const argb = (r: number, g: number, b: number) => ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;

export const TiffDecoder = {
  decode(tiff: Uint8Array): Argb8888 {
    require(tiff.length >= 8, () => `TIFF too small: ${tiff.length}`);
    require(tiff[0] === 0x49 && tiff[1] === 0x49, () => "TIFF must be little-endian");
    require(tiff[2] === 0x2a && tiff[3] === 0x00, () => "TIFF magic mismatch");

    const ifdOffset = readIntLE(tiff, 4);
    const numEntries = readUShortLE(tiff, ifdOffset);

    let width = 0;
    let height = 0;
    let bitsPerSample = [8];
    let compression = 1;
    let photometric = 2;
    let stripOffsets: number[] = [];
    let samplesPerPixel = 1;
    let stripByteCounts: number[] = [];
    let planarConfig = 1;
    let colorMap: number[] | null = null;
    let predictor = 1;

    for (let i = 0; i < numEntries; i++) {
      const entryOff = ifdOffset + 2 + i * 12;
      const tag = readUShortLE(tiff, entryOff);
      const type = readUShortLE(tiff, entryOff + 2);
      const count = readIntLE(tiff, entryOff + 4);
      const valueOff = entryOff + 8;

      const readValue = () => readValues(tiff, type, count, valueOff);

      switch (tag) {
        case TAG_IMAGE_WIDTH: width = readValue()[0]; break;
        case TAG_IMAGE_LENGTH: height = readValue()[0]; break;
        case TAG_BITS_PER_SAMPLE: bitsPerSample = readValue(); break;
        case TAG_COMPRESSION: compression = readValue()[0]; break;
        case TAG_PHOTOMETRIC: photometric = readValue()[0]; break;
        case TAG_STRIP_OFFSETS: stripOffsets = readValue(); break;
        case TAG_SAMPLES_PER_PIXEL: samplesPerPixel = readValue()[0]; break;
        case TAG_STRIP_BYTE_COUNTS: stripByteCounts = readValue(); break;
        case TAG_PLANAR_CONFIG: planarConfig = readValue()[0]; break;
        case TAG_COLORMAP: colorMap = readValue(); break;
        case TAG_PREDICTOR: predictor = readValue()[0]; break;
      }
    }

    require(compression === 1 || compression === 5, () => `TIFF compression=${compression} (only uncompressed/LZW supported)`);
    require(predictor === 1 || predictor === 2, () => `TIFF predictor=${predictor} (only none/horizontal supported)`);
    require(planarConfig === 1, () => `TIFF planar=${planarConfig} (only chunky supported)`);
    require(width > 0 && height > 0, () => "TIFF empty");

    const w = width;
    const h = height;
    const spp = samplesPerPixel;

    let rawBytes: Uint8Array;
    if (stripOffsets.length === 1 && compression === 1) {
      const off = stripOffsets[0];
      rawBytes = tiff.slice(off, off + stripByteCounts[0]);
    } else {
      const out: number[] = [];
      for (let i = 0; i < stripOffsets.length; i++) {
        const start = stripOffsets[i];
        const end = start + stripByteCounts[i];
        if (compression === 5) decompressLzw(out, tiff, start, end);
        else for (let j = start; j < end; j++) out.push(tiff[j]);
      }
      rawBytes = Uint8Array.from(out);
    }

    if (predictor === 2) {
      const rowBytes = w * spp;
      for (let row = 0; row < h; row++) {
        const rowStart = row * rowBytes;
        for (let i = rowStart + spp; i < rowStart + rowBytes; i++) rawBytes[i] = rawBytes[i] + rawBytes[i - spp];
      }
    }

    switch (photometric) {
      case 0:
      case 1:
        return decodeGrayscale(w, h, bitsPerSample, spp, rawBytes, photometric === 0);
      case 2:
        return decodeRgb(w, h, bitsPerSample, spp, rawBytes);
      case 3:
        if (!colorMap) throw new Error("Palette image missing ColorMap");
        return decodePalette(w, h, bitsPerSample, spp, rawBytes, colorMap);
      default:
        throw new Error(`TIFF photometric=${photometric} not supported`);
    }
  },
};

function decodeRgb(width: number, height: number, bps: number[], spp: number, raw: Uint8Array): Argb8888 {
  require(bps.every((it) => it === 8), () => `RGB TIFF: only 8bps supported, got ${bps}`);
  require(spp === 3 || spp === 4, () => `RGB TIFF: spp must be 3 or 4, got ${spp}`);

  const pixels = new Uint32Array(width * height);
  let src = 0;
  for (let p = 0; p < width * height; p++) {
    pixels[p] = argb(raw[src], raw[src + 1], raw[src + 2]);
    src += spp;
  }
  return new Argb8888(width, height, pixels);
}

function decodeGrayscale(width: number, height: number, bps: number[], spp: number, raw: Uint8Array, invert: boolean): Argb8888 {
  require(bps.length === 1 && bps[0] === 8, () => "Grayscale: only 8bps supported");
  require(spp === 1 || spp === 2, () => `Grayscale: spp must be 1 or 2, got ${spp}`);

  const pixels = new Uint32Array(width * height);
  let src = 0;
  for (let p = 0; p < width * height; p++) {
    let v = raw[src];
    if (invert) v = ~v & 0xff;
    pixels[p] = argb(v, v, v);
    src += spp;
  }
  return new Argb8888(width, height, pixels);
}

function decodePalette(width: number, height: number, bps: number[], spp: number, raw: Uint8Array, colorMap: number[]): Argb8888 {
  require(bps.length === 1 && bps[0] === 8, () => "Palette: only 8bps supported");
  require(spp === 1, () => `Palette: spp must be 1, got ${spp}`);
  // Palette: 3 * 2^bits entries, each uint16. Order: all reds, then all greens, then all blues
  const nColors = 1 << bps[0];
  require(colorMap.length === 3 * nColors, () => `ColorMap size mismatch: ${colorMap.length} vs ${3 * nColors}`);

  const pixels = new Uint32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const idx = raw[p];
    const r = (colorMap[idx] >>> 8) & 0xff;
    const g = (colorMap[nColors + idx] >>> 8) & 0xff;
    const b = (colorMap[2 * nColors + idx] >>> 8) & 0xff;
    pixels[p] = argb(r, g, b);
  }
  return new Argb8888(width, height, pixels);
}

function readValues(tiff: Uint8Array, type: number, count: number, valueOff: number): number[] {
  let elemSize: number;
  switch (type) {
    case TYPE_BYTE:
    case TYPE_ASCII: elemSize = 1; break;
    case TYPE_SHORT: elemSize = 2; break;
    case TYPE_LONG: elemSize = 4; break;
    case TYPE_RATIONAL: elemSize = 8; break;
    default: throw new Error(`Unsupported TIFF type: ${type}`);
  }
  const totalSize = elemSize * count;
  const base = totalSize <= 4 ? valueOff : readIntLE(tiff, valueOff);

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (type === TYPE_BYTE) out.push(tiff[base + i]);
    else if (type === TYPE_SHORT) out.push(readUShortLE(tiff, base + i * 2));
    else if (type === TYPE_LONG) out.push(readIntLE(tiff, base + i * 4));
    else throw new Error(`Unexpected type in readValues: ${type}`);
  }
  return out;
}

function decompressLzw(sink: number[], input: Uint8Array, start: number, end: number) {
  const clearCode = 256;
  const eoiCode = 257;

  // Dictionary as prefix-link + suffix-byte per code; strings rebuilt via the stack
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) suffix[i] = i;

  let nextCode = 258;
  let codeWidth = 9;
  let prevCode = -1;
  let firstByte = 0;

  // at most 12 + 7 bits are pending, so a plain number holds the buffer
  let bitBuf = 0;
  let bitCount = 0;
  let inputPos = start;

  for (;;) {
    // Refill bit buffer until we have enough bits for one code
    while (bitCount < codeWidth) {
      if (inputPos >= end) return; // Stream ended without EOI, treat as clean end
      bitBuf = ((bitBuf << 8) | input[inputPos]) & 0xffffff;
      inputPos++;
      bitCount += 8;
    }
    // Pull MSB-first
    const code = (bitBuf >>> (bitCount - codeWidth)) & ((1 << codeWidth) - 1);
    bitCount -= codeWidth;

    if (code === eoiCode) break;
    if (code === clearCode) {
      nextCode = 258;
      codeWidth = 9;
      prevCode = -1;
      continue;
    }

    let sp = 0;
    if (code < nextCode) {
      let c = code;
      while (c >= 256) {
        stack[sp++] = suffix[c];
        c = prefix[c];
      }
      firstByte = c;
      stack[sp++] = c;
    } else if (code === nextCode && prevCode >= 0) {
      // KwKwK: string == previous string + its own first byte
      stack[sp++] = firstByte;
      let c = prevCode;
      while (c >= 256) {
        stack[sp++] = suffix[c];
        c = prefix[c];
      }
      firstByte = c;
      stack[sp++] = c;
    } else {
      throw new Error(`LZW invalid code ${code} (next ${nextCode}, prev ${prevCode})`);
    }

    // stack holds the string reversed
    for (let i = sp - 1; i >= 0; i--) sink.push(stack[i]);

    // New entry = prevString + firstByte(currentString); TIFF "early change" width bump
    if (prevCode >= 0 && nextCode < 4096) {
      prefix[nextCode] = prevCode;
      suffix[nextCode] = firstByte;
      nextCode++;
      if (nextCode === (1 << codeWidth) - 1 && codeWidth < 12) codeWidth++;
    }
    prevCode = code;
  }
}
