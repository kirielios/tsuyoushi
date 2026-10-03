// keiyoushi.utils.parseAsProto<T>() (kotlinx.serialization.protobuf). Kotlin reads @ProtoNumber annotations; here the
// DTO's shape is given as a schema: field number -> [property name, type, repeated?]. Absent fields stay undefined
// (repeated ones become []), so ports apply the DTO's defaults with `??`. Unknown fields are skipped, as kotlinx does.

export type ProtoType = "string" | "int" | "long" | "bool" | "bytes" | ProtoSchema;
export interface ProtoSchema {
  [field: number]: [name: string, type: ProtoType, repeated?: boolean];
}

export function decodeProto<T>(bytes: Uint8Array, schema: ProtoSchema): T {
  let pos = 0;
  const varint = (): bigint => {
    let result = 0n;
    for (let shift = 0n; ; shift += 7n) {
      const b = bytes[pos++];
      if (b === undefined) throw new Error("Truncated protobuf");
      result |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) return result;
    }
  };
  const out: Record<string, unknown> = {};
  for (const [name, , repeated] of Object.values(schema)) if (repeated) out[name] = [];
  while (pos < bytes.length) {
    const tag = Number(varint());
    const field = tag >>> 3;
    const wire = tag & 7;
    const def = schema[field];
    let value: unknown;
    if (wire === 0) {
      const v = varint();
      value = def?.[1] === "bool" ? v !== 0n : def?.[1] === "long" ? Number(BigInt.asIntN(64, v)) : Number(BigInt.asIntN(32, v));
    } else if (wire === 2) {
      const len = Number(varint());
      const chunk = bytes.subarray(pos, pos + len);
      pos += len;
      if (!def) continue;
      const type = def[1];
      if (typeof type === "object") value = decodeProto(chunk, type);
      else if (type === "string") value = new TextDecoder().decode(chunk);
      else if (type === "bytes") value = chunk;
      else continue; // ponytail: packed repeated scalars unsupported, add when a DTO needs them
    } else if (wire === 1) {
      pos += 8;
      continue;
    } else if (wire === 5) {
      pos += 4;
      continue;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
    if (!def) continue;
    if (def[2]) (out[def[0]] as unknown[]).push(value);
    else out[def[0]] = value;
  }
  return out as T;
}
