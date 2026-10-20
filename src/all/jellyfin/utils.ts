// Port of yuzono/anime-extensions src/all/jellyfin/Utils.kt
import type { DeviceProfileDto, ProfileDto, SubtitleProfileDto } from "./dto.ts";

export interface DeviceInfo {
  clientName: string;
  version: string;
  id: string;
  name: string;
}

const NEWLINE_REGEX = /\n/g;
const EXPR_REGEX = /^(\w+)(?:\s*([+\-*/])\s*([\d.]+))?(?::(.+))?$/;

/** java.net.URLEncoder.encode */
const urlEncode = (s: string) => encodeURIComponent(s).replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");

// From https://github.com/jellyfin/jellyfin-sdk-kotlin
export function getAuthHeader(deviceInfo: DeviceInfo, token: string | null = null): string {
  const params: [string, string | null][] = [
    ["Client", deviceInfo.clientName],
    ["Version", deviceInfo.version],
    ["DeviceId", deviceInfo.id],
    ["Device", deviceInfo.name],
    ["Token", token],
  ];
  return (
    "MediaBrowser " +
    params
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${key}="${urlEncode(value!.trim().replace(NEWLINE_REGEX, " "))}"`)
      .join(", ")
  );
}

export function getImageUrl(tag: string, baseUrl: string, id: string, name = "Primary", index: number | null = null): string {
  const url = new URL(baseUrl);
  const segments = ["Items", id, "Images", name, ...(index != null ? [String(index)] : [])].map(encodeURIComponent);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${segments.join("/")}`;
  url.searchParams.append("tag", tag);
  return url.href;
}

export interface Quality {
  videoBitrate: number;
  audioBitrate: number;
  description: string;
}

export const Constants = {
  QUALITIES_LIST: [
    [420_000, 128_000, "420 kbps"],
    [720_000, 192_000, "720 kbps"],
    [1_500_000, 192_000, "1.5 Mbps"],
    [3_000_000, 192_000, "3 Mbps"],
    [4_000_000, 192_000, "4 Mbps"],
    [6_000_000, 192_000, "6 Mbps"],
    [8_000_000, 192_000, "8 Mbps"],
    [10_000_000, 192_000, "10 Mbps"],
    [15_000_000, 192_000, "15 Mbps"],
    [20_000_000, 192_000, "20 Mbps"],
    [40_000_000, 192_000, "40 Mbps"],
    [60_000_000, 192_000, "60 Mbps"],
    [80_000_000, 192_000, "80 Mbps"],
    [120_000_000, 192_000, "120 Mbps"],
  ].map(([videoBitrate, audioBitrate, description]): Quality => ({ videoBitrate: videoBitrate as number, audioBitrate: audioBitrate as number, description: description as string })),

  LANG_CODES: new Set([
  "aar", "abk", "ace", "ach", "ada", "ady", "afh", "afr", "ain", "aka", "akk", "ale", "alt", "amh", "ang", "anp",
  "apa", "ara", "arc", "arg", "arn", "arp", "arw", "asm", "ast", "ath", "ava", "ave", "awa", "aym", "aze", "bai",
  "bak", "bal", "bam", "ban", "bas", "bej", "bel", "bem", "ben", "ber", "bho", "bik", "bin", "bis", "bla", "bod",
  "bos", "bra", "bre", "bua", "bug", "bul", "byn", "cad", "car", "cat", "ceb", "ces", "cha", "chb", "che", "chg",
  "chk", "chm", "chn", "cho", "chp", "chr", "chu", "chv", "chy", "cnr", "cop", "cor", "cos", "cre", "crh", "csb",
  "cym", "dak", "dan", "dar", "del", "den", "deu", "dgr", "din", "div", "doi", "dsb", "dua", "dum", "dyu", "dzo",
  "efi", "egy", "eka", "ell", "elx", "eng", "enm", "epo", "est", "eus", "ewe", "ewo", "fan", "fao", "fas", "fat",
  "fij", "fil", "fin", "fiu", "fon", "fra", "frm", "fro", "frr", "frs", "fry", "ful", "fur", "gaa", "gay", "gba",
  "gez", "gil", "gla", "gle", "glg", "glv", "gmh", "goh", "gon", "gor", "got", "grb", "grc", "grn", "gsw", "guj",
  "gwi", "hai", "hat", "hau", "haw", "heb", "her", "hil", "hin", "hit", "hmn", "hmo", "hrv", "hsb", "hun", "hup",
  "hye", "iba", "ibo", "ido", "iii", "ijo", "iku", "ile", "ilo", "ina", "inc", "ind", "inh", "ipk", "isl", "ita",
  "jav", "jbo", "jpn", "jpr", "jrb", "kaa", "kab", "kac", "kal", "kam", "kan", "kar", "kas", "kat", "kau", "kaw",
  "kaz", "kbd", "kha", "khm", "kho", "kik", "kin", "kir", "kmb", "kok", "kom", "kon", "kor", "kos", "kpe", "krc",
  "krl", "kru", "kua", "kum", "kur", "kut", "lad", "lah", "lam", "lao", "lat", "lav", "lez", "lim", "lin", "lit",
  "lol", "loz", "ltz", "lua", "lub", "lug", "lui", "lun", "luo", "lus", "mad", "mag", "mah", "mai", "mak", "mal",
  "man", "mar", "mas", "mdf", "mdr", "men", "mga", "mic", "min", "mkd", "mkh", "mlg", "mlt", "mnc", "mni", "moh",
  "mon", "mos", "mri", "msa", "mus", "mwl", "mwr", "mya", "myv", "nah", "nap", "nau", "nav", "nbl", "nde", "ndo",
  "nds", "nep", "new", "nia", "nic", "niu", "nld", "nno", "nob", "nog", "non", "nor", "nqo", "nso", "nub", "nwc",
  "nya", "nym", "nyn", "nyo", "nzi", "oci", "oji", "ori", "orm", "osa", "oss", "ota", "oto", "pag", "pal", "pam",
  "pan", "pap", "pau", "peo", "phn", "pli", "pol", "pon", "por", "pro", "pus", "que", "raj", "rap", "rar", "roh",
  "rom", "ron", "run", "rup", "rus", "sad", "sag", "sah", "sam", "san", "sas", "sat", "scn", "sco", "sel", "sga",
  "shn", "sid", "sin", "slk", "slv", "sma", "sme", "smj", "smn", "smo", "sms", "sna", "snd", "snk", "sog", "som",
  "son", "sot", "spa", "sqi", "srd", "srn", "srp", "srr", "ssw", "suk", "sun", "sus", "sux", "swa", "swe", "syc",
  "syr", "tah", "tai", "tam", "tat", "tel", "tem", "ter", "tet", "tgk", "tgl", "tha", "tig", "tir", "tiv", "tkl",
  "tlh", "tli", "tmh", "tog", "ton", "tpi", "tsi", "tsn", "tso", "tuk", "tum", "tup", "tur", "tvl", "twi", "tyv",
  "udm", "uga", "uig", "ukr", "umb", "urd", "uzb", "vai", "ven", "vie", "vol", "vot", "wal", "war", "was", "wen",
  "wln", "wol", "xal", "xho", "yao", "yap", "yid", "yor", "zap", "zbl", "zen", "zgh", "zha", "zho", "zul", "zun",
  "zza",
  ]),
};

// From https://github.com/jellyfin/jellyfin-mpv-shim/blob/6cc27da739180a65baadfd981e42662bdf248221/jellyfin_mpv_shim/utils.py#L100
export function getDeviceProfile(name: string, videoCodec: string, videoBitrate: number, audioBitrate: number): DeviceProfileDto {
  const subtitleProfilesList: SubtitleProfileDto[] = [];
  for (const it of ["srt", "ass", "sub", "ssa", "smi"]) {
    subtitleProfilesList.push({ Format: it, Method: "External" });
    subtitleProfilesList.push({ Format: it, Method: "Embed" });
  }
  for (const it of ["pgssub", "dvdsub", "dvbsub", "pgs"]) subtitleProfilesList.push({ Format: it, Method: "Embed" });

  const video: ProfileDto = {
    Type: "Video",
    // The app's FFmpeg can't seek fMP4 HLS, so use MPEG-TS segments when the codec fits in them
    Container: videoCodec.trim().toLowerCase() === "h264" ? "ts" : "mp4",
    Protocol: "hls",
    AudioCodec: "aac,mp3,ac3,opus,flac,vorbis",
    VideoCodec: videoCodec,
    MaxAudioChannels: "6",
  };
  return {
    Name: name,
    MaxStreamingBitrate: videoBitrate,
    MaxStaticBitrate: videoBitrate,
    MusicStreamingTranscodingBitrate: audioBitrate,
    TranscodingProfiles: [{ Type: "Audio" }, { Type: "Photo", Container: "jpeg" }, video],
    DirectPlayProfiles: [{ Type: "Audio" }, { Type: "Photo" }, { Type: "Video" }],
    ResponseProfiles: [],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: subtitleProfilesList,
  };
}

/** The slice of java.lang.String.format(Locale.US, "%<flags><width>.<precision><conversion>", value) templates use. */
function javaFormat(spec: string, value: string | number): string {
  const m = /^%([-#+ 0,(]*)(\d+)?(?:\.(\d+))?([a-zA-Z])$/.exec(spec);
  if (!m) throw new Error(`Invalid format: ${spec}`); // IllegalArgumentException
  const [, flags, widthStr, precStr, conv] = m;
  const prec = precStr != null ? Number(precStr) : null;
  let out: string;
  const n = typeof value === "number" ? value : Number.NaN;
  const group = (s: string) => (flags.includes(",") ? s.replace(/^(-?\d+)/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ",")) : s);
  switch (conv) {
    case "s":
    case "S":
      out = String(value);
      if (prec != null) out = out.slice(0, prec);
      if (conv === "S") out = out.toUpperCase();
      break;
    case "d":
      if (typeof value !== "number") throw new Error(`Invalid format: ${spec}`);
      out = group(String(Math.trunc(n)));
      break;
    case "o":
      out = Math.trunc(n).toString(8);
      break;
    case "x":
    case "X":
      out = Math.trunc(n).toString(16);
      if (conv === "X") out = out.toUpperCase();
      break;
    case "f":
      if (typeof value !== "number") throw new Error(`Invalid format: ${spec}`);
      out = group(n.toFixed(prec ?? 6));
      break;
    case "e":
    case "E":
      if (typeof value !== "number") throw new Error(`Invalid format: ${spec}`);
      out = n.toExponential(prec ?? 6).replace(/e([+-])(\d)$/, "e$10$2");
      if (conv === "E") out = out.toUpperCase();
      break;
    default:
      throw new Error(`Invalid format: ${spec}`);
  }
  if (flags.includes("+") && typeof value === "number" && n >= 0 && "dfeE".includes(conv)) out = `+${out}`;
  const width = widthStr != null ? Number(widthStr) : 0;
  if (out.length < width) {
    if (flags.includes("-")) out = out.padEnd(width);
    else if (flags.includes("0") && typeof value === "number") {
      const sign = /^[+-]/.test(out) ? out[0] : "";
      out = sign + out.slice(sign.length).padStart(width - sign.length, "0");
    } else out = out.padStart(width);
  }
  return out;
}

/** Utils.kt's format: org.apache.commons.text.StringSubstitutor with "{", "}" and the escape character '\'. */
export function format(values: Record<string, string | number>, input: string): string {
  const lookup = (key: string): string => {
    const match = EXPR_REGEX.exec(key);
    if (!match) throw new Error(`Invalid format: ${key}`);
    const [, valueKey, operator = "", operand = "", formatStr = ""] = match;
    const value = values[valueKey];
    let result: string | number;
    if (typeof value === "string") result = value;
    else if (typeof value === "number" && operator === "") result = value;
    else if (typeof value === "number") {
      const op2 = Number(operand);
      result = operator === "+" ? value + op2 : operator === "-" ? value - op2 : operator === "*" ? value * op2 : value / op2;
    } else throw new Error(`Missing value: ${valueKey}`);

    const spec = `%${formatStr}`;
    if (typeof result === "string") return formatStr === "" ? result : javaFormat(spec, result);
    if (formatStr === "") return Number.isInteger(result) ? String(Math.trunc(result)) : String(result);
    return /[dox]$/i.test(spec) ? javaFormat(spec, Math.trunc(result)) : javaFormat(spec, result);
  };
  return input.replace(/(\\)?\{([^{}]*)\}/g, (m, esc: string | undefined, key: string) => (esc ? m.slice(1) : lookup(key)));
}
