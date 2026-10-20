// Port of aniyomi lib/dailymotionextractor.
import { Track, type Video } from "../../sdk/anime.ts";
import { POST } from "../../sdk/httpsource.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";
import { PlaylistUtils } from "../playlistutils/index.ts";

const DAILYMOTION_URL = "https://www.dailymotion.com";
const GRAPHQL_URL = "https://graphql.api.dailymotion.com";

interface DailyQuality {
  qualities?: { auto: { url: string }[] } | null;
  /** An object keyed by language upstream turns into a list (SubtitleListSerializer). */
  subtitles?: { data: Record<string, { label: string; urls: string[] }> | unknown } | null;
  error?: { type: string } | null;
  id?: string | null;
}
interface TokenResponse {
  access_token: string;
  token_type: string;
}
interface ProtectedResponse {
  data: { video: { xid: string } };
}

export class DailymotionExtractor {
  private readonly playlistUtils: PlaylistUtils;
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {
    this.playlistUtils = new PlaylistUtils(client, headers);
  }

  private headersBuilder(block: (h: Headers) => void = () => {}): Headers {
    const h = new Headers(this.headers);
    h.append("Accept", "*/*");
    h.set("Referer", `${DAILYMOTION_URL}/`);
    h.set("Origin", DAILYMOTION_URL);
    block(h);
    return h;
  }

  async videosFromUrl(url: string, prefix = "Dailymotion - ", baseUrl = "", password: string | null = null): Promise<Video[]> {
    const htmlString = (await this.client.get(url, new Headers(), { ensureSuccess: false })).text();
    const internalData = substringBefore(substringAfter(htmlString, '"dmInternalData":'), "</script>");
    const ts = substringBefore(substringAfter(internalData, '"ts":'), ",");
    const v1st = substringBefore(substringAfter(internalData, '"v1st":"'), '",');

    const u = new URL(url);
    const videoQuery = u.searchParams.get("video") ?? u.pathname.split("/").at(-1) ?? "";

    const jsonUrl = `${DAILYMOTION_URL}/player/metadata/video/${videoQuery}?locale=en-US&dmV1st=${v1st}&dmTs=${ts}&is_native_app=0`;
    const parsed = (await this.client.get(jsonUrl, new Headers(), { ensureSuccess: false })).parseAs<DailyQuality>();

    if (parsed.qualities != null && parsed.error == null) return this.videosFromDailyResponse(parsed, prefix);
    if (parsed.error?.type === "password_protected" && parsed.id != null) {
      return this.videosFromProtectedUrl(url, prefix, parsed.id, htmlString, ts, v1st, baseUrl, password);
    }
    return [];
  }

  private async videosFromProtectedUrl(url: string, prefix: string, videoId: string, htmlString: string, ts: string, v1st: string, baseUrl: string, password: string | null): Promise<Video[]> {
    const field = (name: string) => substringBefore(substringAfter(htmlString, `${name}":"`), '"');
    const tokenBody = new URLSearchParams({
      client_id: field("client_id"),
      client_secret: field("client_secret"),
      traffic_segment: ts,
      visitor_id: v1st,
      grant_type: "client_credentials",
      scope: field("client_scope"),
    });
    const tokenParsed = (await this.client.execute(POST(`${GRAPHQL_URL}/oauth/token`, this.headersBuilder(), tokenBody))).parseAs<TokenResponse>();

    const idHeaders = this.headersBuilder((h) => {
      h.set("Accept", "application/json, text/plain, */*");
      h.append("Authorization", `${tokenParsed.token_type} ${tokenParsed.access_token}`);
    });
    const idData = JSON.stringify({
      query: "query playerPasswordQuery($videoId:String!,$password:String!){video(xid:$videoId,password:$password){id xid}}",
      variables: { videoId, password: String(password) },
    });
    const idParsed = (await this.client.execute(POST(`${GRAPHQL_URL}/`, idHeaders, idData, "application/json; charset=utf-8"))).parseAs<ProtectedResponse>().data.video;

    const dmvk = substringBefore(substringAfter(htmlString, '"dmvk":"'), '"');
    const getVideoIdUrl = `${DAILYMOTION_URL}/player/metadata/video/${idParsed.xid}?embedder=${baseUrl}/&locale=en-US&dmV1st=${v1st}&dmTs=${ts}&is_native_app=0`;
    const getVideoIdHeaders = this.headersBuilder((h) => {
      h.append("Cookie", `dmvk=${dmvk}; ts=${ts}; v1st=${v1st}; usprivacy=1---; client_token=${tokenParsed.access_token}`);
      h.set("Referer", url);
    });
    const parsed = (await this.client.get(getVideoIdUrl, getVideoIdHeaders, { ensureSuccess: false })).parseAs<DailyQuality>();
    return this.videosFromDailyResponse(parsed, prefix, getVideoIdHeaders);
  }

  private videosFromDailyResponse(parsed: DailyQuality, prefix: string, playlistHeaders: Headers | null = null): Promise<Video[]> {
    const masterUrl = parsed.qualities?.auto?.[0]?.url;
    if (!masterUrl) return Promise.resolve([]);
    const data = parsed.subtitles?.data;
    const subtitleList = data && typeof data === "object" && !Array.isArray(data) ? Object.values(data as Record<string, { label: string; urls: string[] }>).map((it) => new Track(it.urls[0], it.label)) : [];
    const masterHeaders = playlistHeaders ?? this.headersBuilder();
    // ponytail: upstream serves fMP4 qualities through HlsDashServer and adds an "Auto" master first; the one master video
    // PlaylistUtils returns here already is that, and hls.js plays fMP4 and the audio renditions itself
    return this.playlistUtils.extractFromHls(masterUrl, {
      masterHeadersGen: () => masterHeaders,
      videoHeadersGen: () => masterHeaders,
      subtitleList,
      videoNameGen: (q) => `${prefix}${q}`,
    });
  }
}
