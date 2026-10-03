// Port of keiyoushi/extensions-source src/en/kmanga/ImageInterceptor.kt
import { Canvas, imageSize, type Chain, type Host, type Response } from "../../../sdk/index.ts";

const GRID_SIZE = 4;
const CHARSET_EVEN = "we7ru3ty8i";
const CHARSET_ODD = "h4xm9bqz1p";

// https://greasyfork.org/en/scripts/467901-k-manga-ripper
export async function imageInterceptor(host: Host, chain: Chain): Promise<Response> {
  const request = chain.request();
  const response = await chain.proceed(request);
  const fragment = new URL(request.url).hash.replace(/^#/, "");

  if (!response.isSuccessful || !fragment || !fragment.includes(":")) return response;

  const [seed, titleId, episodeId] = fragment.split(":");
  const bytes = response.bytes();
  const { width, height } = await imageSize(host, bytes);
  const result = await unscramble(host, bytes, width, height, seed, Number.parseInt(titleId, 10), Number.parseInt(episodeId, 10));
  return response.withBody(result);
}

const xorshift32 = (value: number): number => {
  let n = value >>> 0;
  n = (n ^ (n << 13)) >>> 0;
  n = (n ^ (n >>> 17)) >>> 0;
  n = (n ^ (n << 5)) >>> 0;
  return n;
};

function getUnscrambledCoords(seed: string, titleId: number, episodeId: number) {
  // WASM decrypts two 10-byte arrays to use as substitution charsets.
  // Selects the charset based on titleId % 2
  const charset = titleId % 2 === 0 ? CHARSET_EVEN : CHARSET_ODD;

  // Maps the string into a base-10 number using the selected charset (only the low 32 bits are ever used)
  let parsedInt = 0;
  for (const char of seed) {
    const index = charset.indexOf(char);
    if (index !== -1) parsedInt = (parsedInt * 10 + index) >>> 0;
    else break;
  }

  // The final 32-bit seed is xor'd against the sum of titleId and episodeId
  let seed32 = (parsedInt ^ ((titleId + episodeId) >>> 0)) >>> 0;

  const pairs: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    seed32 = xorshift32(seed32);
    pairs.push([seed32, i]);
  }
  pairs.sort((a, b) => a[0] - b[0]);

  return pairs.map(([, sourceIndex], destIndex) => ({
    source: { x: sourceIndex % GRID_SIZE, y: Math.floor(sourceIndex / GRID_SIZE) },
    dest: { x: destIndex % GRID_SIZE, y: Math.floor(destIndex / GRID_SIZE) },
  }));
}

async function unscramble(host: Host, image: Uint8Array, width: number, height: number, seed: string, titleId: number, episodeId: number): Promise<Uint8Array> {
  const unscrambledCoords = getUnscrambledCoords(seed, titleId, episodeId);
  const canvas = new Canvas(host, width, height);

  const blockWidth = Math.floor((Math.floor(width / 8) * 8) / 4);
  const blockHeight = Math.floor((Math.floor(height / 8) * 8) / 4);

  for (const it of unscrambledCoords) {
    canvas.drawImage(image, it.source.x * blockWidth, it.source.y * blockHeight, blockWidth, blockHeight, it.dest.x * blockWidth, it.dest.y * blockHeight);
  }

  const processedWidth = blockWidth * GRID_SIZE;
  const processedHeight = blockHeight * GRID_SIZE;

  if (width > processedWidth) canvas.drawImage(image, processedWidth, 0, width - processedWidth, height, processedWidth, 0);
  if (height > processedHeight) canvas.drawImage(image, 0, processedHeight, processedWidth, height - processedHeight, 0, processedHeight);

  return canvas.encode("jpeg", 90);
}
