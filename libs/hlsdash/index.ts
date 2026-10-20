// Port of aniyomi lib/hlsdash. Upstream serves fMP4 HLS media playlists as DASH manifests over a loopback server, because
// the app's FFmpeg cannot seek in fMP4 HLS. hls.js seeks fMP4 HLS fine, so the media playlist is played as it is.
import type { HttpClient } from "../../sdk/network.ts";

export const HlsDashServer = {
  /**
   * Returns the URL to use as the video URL: here the media playlist itself.
   * ponytail: no loopback server in the browser; a separate audio rendition (audioUrl) is dropped, so callers that
   * have one should offer the master playlist instead.
   */
  register(_client: HttpClient, _headers: Headers, videoUrl: string, _audioUrl: string | null): string {
    return videoUrl;
  },
};
