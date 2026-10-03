// Android Bitmap/Canvas for ports that descramble or stitch pages. Draws are recorded and rendered by the host
// (Host.image, sharp in Node) on encode, so bundles carry no image codec.
import type { Host, HostImage, ImageLayer } from "./host.ts";

function hostImage(host: Host): HostImage {
  if (!host.image) throw new Error("This host cannot process images (Host.image is missing), needed to descramble/stitch pages");
  return host.image;
}

/** BitmapFactory.decodeByteArray(...).width/height. Rejects when the bytes are not a decodable image. */
export const imageSize = async (host: Host, bytes: Uint8Array) => hostImage(host).size(bytes);

/** Canvas(Bitmap.createBitmap(width, height)). */
export class Canvas {
  private readonly image: HostImage;
  private readonly layers: ImageLayer[] = [];
  constructor(
    host: Host,
    readonly width: number,
    readonly height: number,
  ) {
    this.image = hostImage(host);
  }

  /** drawBitmap(bitmap, Rect(sx, sy, sx + sw, sy + sh), Rect(dx, dy, dx + sw, dy + sh)), clipped to the canvas like Canvas. */
  drawImage(bytes: Uint8Array, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number): void {
    if (dx < 0) [sx, sw, dx] = [sx - dx, sw + dx, 0];
    if (dy < 0) [sy, sh, dy] = [sy - dy, sh + dy, 0];
    sw = Math.min(sw, this.width - dx);
    sh = Math.min(sh, this.height - dy);
    if (sw > 0 && sh > 0) this.layers.push({ bytes, sx, sy, sw, sh, dx, dy });
  }

  /**
   * canvas.translate(cx, cy); rotate(-90 * quarterTurns); if (flip) scale(-1, 1); drawBitmap(bitmap, Rect(sx, sy, sx + sw, sy + sh), RectF centered on the origin).
   * The source rect is mirrored (flip), then turned counter-clockwise, and centred on (cx, cy); the host clips it to the canvas.
   */
  drawImageTransformed(bytes: Uint8Array, sx: number, sy: number, sw: number, sh: number, cx: number, cy: number, quarterTurns: number, flip: boolean): void {
    const turns = ((quarterTurns % 4) + 4) % 4;
    const [w, h] = turns % 2 ? [sh, sw] : [sw, sh];
    this.layers.push({ bytes, sx, sy, sw, sh, dx: Math.round(cx - w / 2), dy: Math.round(cy - h / 2), flip, rotate: turns });
  }

  /** bitmap.compress(format, quality 0-100). */
  encode(format: "jpeg" | "webp" | "png", quality?: number): Promise<Uint8Array> {
    return this.image.compose({ width: this.width, height: this.height, format, quality, layers: this.layers });
  }
}
