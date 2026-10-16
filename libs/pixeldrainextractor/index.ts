// Port of aniyomi lib/pixeldrainextractor.
import { Video } from "../../sdk/anime.ts";

export class PixelDrainExtractor {
  videosFromUrl(url: string, prefix = ""): Video[] {
    const id = /\/u\/(.*)/.exec(url)?.[1];
    const videoUrl = id ? `https://pixeldrain.com/api/file/${id}?download` : url;
    return [new Video({ videoUrl, videoTitle: `${prefix}PixelDrain` })];
  }
}
