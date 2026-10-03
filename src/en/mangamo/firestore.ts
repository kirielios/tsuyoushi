// Port of keiyoushi/extensions-source src/en/mangamo/FirestoreRequestFactory.kt
import { toHttpUrl, type Request } from "../../../sdk/index.ts";
import type { MangamoAuth } from "./auth.ts";
import { MangamoConstants } from "./constants.ts";
import type { MangamoHelper } from "./helper.ts";

export class DocumentQuery {
  fields: string[] = [];
}

export interface FirestoreFilter {
  toJsonString(): string;
}

class OrderByTerm {
  constructor(
    private readonly field: string,
    private readonly direction: "ASCENDING" | "DESCENDING",
  ) {}
  toJsonString() {
    return `{"direction":"${this.direction}","field":{"fieldPath":"${this.field}"}}`;
  }
}

class CompositeFilter implements FirestoreFilter {
  constructor(
    private readonly op: "AND" | "OR",
    private readonly filters: FirestoreFilter[],
  ) {}
  toJsonString() {
    return `{"compositeFilter":{"op":"${this.op}","filters":[${this.filters.map((it) => it.toJsonString()).join(", ")}]}}`;
  }
}

type FieldOp = "LESS_THAN" | "LESS_THAN_OR_EQUAL" | "GREATER_THAN" | "GREATER_THAN_OR_EQUAL" | "EQUAL" | "NOT_EQUAL" | "ARRAY_CONTAINS" | "IN" | "ARRAY_CONTAINS_ANY" | "NOT_IN";

class FieldFilter implements FirestoreFilter {
  constructor(
    private readonly fieldName: string,
    private readonly op: FieldOp,
    private readonly value: unknown,
  ) {}
  toJsonString() {
    const value = this.value;
    let valueTerm: string;
    if (value === null || value === undefined) valueTerm = '{"nullValue":null}';
    else if (typeof value === "number") valueTerm = Number.isInteger(value) ? `{"integerValue":${value}}` : `{"doubleValue":${value}}`;
    else if (typeof value === "string") valueTerm = `{"stringValue":${JSON.stringify(value)}}`;
    else if (typeof value === "boolean") valueTerm = `{"booleanValue":${value}}`;
    else throw new Error(`${typeof value} not supported in field filters`);
    return `{"fieldFilter":{"op":"${this.op}","field":{"fieldPath":"${this.fieldName}"},"value":${valueTerm}}}`;
  }
}

class UnaryFilter implements FirestoreFilter {
  constructor(
    private readonly fieldName: string,
    private readonly op: "IS_NAN" | "IS_NULL" | "IS_NOT_NAN" | "IS_NOT_NULL",
  ) {}
  toJsonString() {
    return `{"unaryFilter":{"op":"${this.op}","field":{"fieldPath":"${this.fieldName}"}}}`;
  }
}

export class CollectionQuery extends DocumentQuery {
  filter: FirestoreFilter | null = null;
  orderBy: OrderByTerm[] | null = null;

  // Firestore supports cursors, but this is simpler and probably good enough
  limit: number | null = null;
  offset: number | null = null;

  ascending = (field: string) => new OrderByTerm(field, "ASCENDING");
  descending = (field: string) => new OrderByTerm(field, "DESCENDING");

  and = (...filters: FirestoreFilter[]) => new CompositeFilter("AND", filters);
  or = (...filters: FirestoreFilter[]) => new CompositeFilter("OR", filters);
  isLessThan = (f: string, v: unknown) => new FieldFilter(f, "LESS_THAN", v);
  isLessThanOrEqual = (f: string, v: unknown) => new FieldFilter(f, "LESS_THAN_OR_EQUAL", v);
  isGreaterThan = (f: string, v: unknown) => new FieldFilter(f, "GREATER_THAN", v);
  isGreaterThanOrEqual = (f: string, v: unknown) => new FieldFilter(f, "GREATER_THAN_OR_EQUAL", v);
  isEqual = (f: string, v: unknown) => new FieldFilter(f, "EQUAL", v);
  isNotEqual = (f: string, v: unknown) => new FieldFilter(f, "NOT_EQUAL", v);
  contains = (f: string, v: unknown) => new FieldFilter(f, "ARRAY_CONTAINS", v);
  isIn = (f: string, v: unknown) => new FieldFilter(f, "IN", v);
  containsAny = (f: string, v: unknown) => new FieldFilter(f, "ARRAY_CONTAINS_ANY", v);
  isNotIn = (f: string, v: unknown) => new FieldFilter(f, "NOT_IN", v);
  isNaN = (f: string) => new UnaryFilter(f, "IS_NAN");
  isNull = (f: string) => new UnaryFilter(f, "IS_NULL");
  isNotNaN = (f: string) => new UnaryFilter(f, "IS_NOT_NAN");
  isNotNull = (f: string) => new UnaryFilter(f, "IS_NOT_NULL");
}

export class FirestoreRequestFactory {
  constructor(
    private readonly helper: MangamoHelper,
    private readonly auth: MangamoAuth,
  ) {}

  async getDocument(path: string, query: (q: DocumentQuery) => void = () => {}): Promise<Request> {
    const queryInfo = new DocumentQuery();
    query(queryInfo);

    const urlBuilder = toHttpUrl(`${MangamoConstants.FIRESTORE_API_BASE_PATH}/${path}`).newBuilder();

    for (const field of queryInfo.fields) {
      urlBuilder.addQueryParameter("mask.fieldPaths", field);
    }

    const headers = new Headers({ Authorization: `Bearer ${await this.auth.getIdToken()}` });

    return { url: urlBuilder.build().toString(), method: "GET", headers };
  }

  private deconstructCollectionPath(path: string): [string, string] {
    const pivot = path.lastIndexOf("/");
    if (pivot === -1) {
      return ["", path];
    }
    return [path.substring(0, pivot), path.substring(pivot + 1)];
  }

  async getCollection(fullPath: string, query: (q: CollectionQuery) => void = () => {}): Promise<Request> {
    const queryInfo = new CollectionQuery();
    query(queryInfo);

    const structuredQuery = new Map<string, string | null>();

    const [path, collectionId] = this.deconstructCollectionPath(fullPath);

    structuredQuery.set("from", `{"collectionId":"${collectionId}"}`);

    if (queryInfo.fields.length > 0) {
      structuredQuery.set("select", `{"fields":[${queryInfo.fields.map((it) => `{"fieldPath":"${it}"}`).join(", ")}]}`);
    }

    if (queryInfo.filter !== null) {
      structuredQuery.set("where", queryInfo.filter.toJsonString());
    }

    if (queryInfo.orderBy !== null) {
      structuredQuery.set("orderBy", `[${queryInfo.orderBy.map((it) => it.toJsonString()).join(", ")}]`);
    }

    structuredQuery.set("offset", queryInfo.offset?.toString() ?? null);
    structuredQuery.set("limit", queryInfo.limit?.toString() ?? null);

    const headers = this.helper.jsonHeaders;
    headers.append("Authorization", `Bearer ${await this.auth.getIdToken()}`);

    const body = `{"structuredQuery":{${[...structuredQuery.entries()]
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `"${k}":${v}`)
      .join(", ")}}}`;

    return { url: `${MangamoConstants.FIRESTORE_API_BASE_PATH}/${path}:runQuery`, method: "POST", headers, body };
  }
}
