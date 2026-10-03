// Port of keiyoushi/extensions-source lib/e4p/E4PManifestDto.kt
//
// kotlinx.serialization.protobuf classes become interfaces plus decodeProto schemas; the Kotlin defaults are
// applied by the with*Defaults helpers after decoding.
import { decodeProto, type ProtoSchema } from "../../sdk/protobuf.ts";

const EMPTY = new Uint8Array(0);

export interface Timestamp {
  seconds: number;
}

export interface E4PQSWrapper {
  type: number;
  iv: Uint8Array;
  checksum: Uint8Array;
  data: Uint8Array;
  dataType: number;
  dictChecksum: number;
}

export interface E4PQSTicket {
  type: number;
  contentId: string;
  consumer: string;
  expires: Timestamp;
  child: E4PQSWrapper;
}

export const TicketType = { PLAIN_UNSPECIFIED: 0, TDRM_V1: 2 } as const;
export const WrapperType = { PLAIN_UNSPECIFIED: 0, CDRM_V1: 2 } as const;
export const DataType = { PROTOPUB: 2, PROTOPUB_ZLIB: 5 } as const;

export interface EDRM {
  version: number;
  iv: Uint8Array;
}
export interface ImageProps {
  drm: EDRM | null;
}
export interface Variant {
  link: string;
  image: ImageProps | null;
}
export interface Link {
  variants: Variant[];
}
export interface ProtoPub {
  spine: Link[];
}

export const EdrmVersion = { XEBP: 2 } as const;

const TimestampSchema: ProtoSchema = { 1: ["seconds", "long"] };
const WrapperSchema: ProtoSchema = {
  1: ["type", "int"],
  2: ["iv", "bytes"],
  3: ["checksum", "bytes"],
  4: ["data", "bytes"],
  5: ["dataType", "int"],
  6: ["dictChecksum", "int"],
};
const TicketSchema: ProtoSchema = {
  1: ["type", "int"],
  2: ["contentId", "string"],
  3: ["consumer", "string"],
  4: ["expires", TimestampSchema],
  5: ["child", WrapperSchema],
};
const EdrmSchema: ProtoSchema = { 1: ["version", "int"], 3: ["iv", "bytes"] };
const VariantSchema: ProtoSchema = { 1: ["link", "string"], 2: ["image", { 3: ["drm", EdrmSchema] }] };
const ProtoPubSchema: ProtoSchema = { 2: ["spine", { 1: ["variants", VariantSchema, true] }, true] };

const wrapperDefaults = (w: Partial<E4PQSWrapper> = {}): E4PQSWrapper => ({
  type: w.type ?? 0,
  iv: w.iv ?? EMPTY,
  checksum: w.checksum ?? EMPTY,
  data: w.data ?? EMPTY,
  dataType: w.dataType ?? 0,
  dictChecksum: w.dictChecksum ?? 0,
});

/** parseAsProto<E4PQSTicket>() */
export function decodeTicket(bytes: Uint8Array): E4PQSTicket {
  const t = decodeProto<Partial<E4PQSTicket> & { expires?: Partial<Timestamp>; child?: Partial<E4PQSWrapper> }>(bytes, TicketSchema);
  if (t.type === undefined || t.contentId === undefined || t.consumer === undefined) throw new Error("E4PQSTicket: missing required field");
  return { type: t.type, contentId: t.contentId, consumer: t.consumer, expires: { seconds: t.expires?.seconds ?? 0 }, child: wrapperDefaults(t.child) };
}

/** decodeProto<ProtoPub>() */
export function decodeProtoPub(bytes: Uint8Array): ProtoPub {
  type RawVariant = { link?: string; image?: { drm?: { version?: number; iv?: Uint8Array } } };
  const raw = decodeProto<{ spine: { variants: RawVariant[] }[] }>(bytes, ProtoPubSchema);
  return {
    spine: raw.spine.map((l) => ({
      variants: l.variants.map((v) => {
        if (v.link === undefined) throw new Error("Variant: missing link");
        const drm = v.image?.drm;
        if (drm && drm.iv === undefined) throw new Error("EDRM: missing iv");
        return { link: v.link, image: v.image ? { drm: drm ? { version: drm.version ?? 0, iv: drm.iv! } : null } : null };
      }),
    })),
  };
}
