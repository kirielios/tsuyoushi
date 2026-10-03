// kotlinx.serialization helpers as used by sources: JsonElement is plain `unknown` here.

/** keiyoushi's String.parseAs<T>() */
export const parseAs = <T>(text: string): T => JSON.parse(text) as T;
/** toJsonElement() / toJsonString() */
export const toJsonElement = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));
export const toJsonString = (value: unknown): string => JSON.stringify(value);
/** JsonElement?.jsonPrimitive?.content / keiyoushi's `.string`: the primitive's text, or undefined. */
export function str(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === "object") return undefined;
  return String(value);
}

/** keiyoushi.utils.GraphQL: thrown by parseGraphQLAs when "errors" is non-empty. */
export class GraphQLException extends Error {}
/** String/Response.parseGraphQLAs<T>(): unwraps "data", throwing on "errors" or a missing "data". */
export function parseGraphQLAs<T>(text: string): T {
  const envelope = JSON.parse(text) as { data?: T | null; errors?: { message: string }[] | null };
  if (envelope.errors?.length) throw new GraphQLException(envelope.errors.map((it) => it.message).join("\n"));
  if (envelope.data == null) throw new Error("GraphQL response is missing the 'data' field");
  return envelope.data;
}
/** graphQLBody(query, operationName, variables, extensions): the JSON text; send it with Content-Type application/json. Nulls are dropped (explicitNulls = false). */
export const graphQLBody = (body: { query?: string; operationName?: string; variables?: unknown; extensions?: unknown }): string =>
  JSON.stringify({ operationName: body.operationName, query: body.query, variables: body.variables, extensions: body.extensions }, (_k, v: unknown) => (v === null ? undefined : v));
