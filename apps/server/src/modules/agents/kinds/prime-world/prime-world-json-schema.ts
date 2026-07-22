import Ajv, { type ValidateFunction } from "ajv";
import type { JsonObject, JsonValue } from "@echoo/shared";

const ALLOWED_KEYS = new Set([
  "type",
  "properties",
  "items",
  "required",
  "additionalProperties",
  "enum",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "description",
  "title",
]);
const ALLOWED_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true });
const validatorCache = new Map<string, ValidateFunction<JsonValue>>();

export function assertSafePrimeWorldJsonSchema(schema: JsonObject) {
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > 128 * 1024)
    throw new Error("JSON_SCHEMA_TOO_LARGE");
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (value: JsonValue, depth: number, pointer: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (seen.has(value)) throw new Error(`JSON_SCHEMA_RECURSIVE:${pointer}`);
    if (depth > 12) throw new Error(`JSON_SCHEMA_TOO_DEEP:${pointer}`);
    nodes += 1;
    if (nodes > 500) throw new Error("JSON_SCHEMA_TOO_LARGE");
    seen.add(value);
    for (const key of Object.keys(value))
      if (!ALLOWED_KEYS.has(key))
        throw new Error(`JSON_SCHEMA_KEY_NOT_ALLOWED:${pointer}/${key}`);
    const type = value.type;
    if (typeof type !== "string" || !ALLOWED_TYPES.has(type))
      throw new Error(`JSON_SCHEMA_INVALID_TYPE:${pointer}/type`);
    if (type === "object") {
      if (value.additionalProperties !== false)
        throw new Error(`JSON_SCHEMA_REQUIRES_CLOSED_OBJECT:${pointer}`);
      const properties = value.properties;
      if (properties !== undefined) {
        if (!properties || typeof properties !== "object" || Array.isArray(properties))
          throw new Error(`JSON_SCHEMA_INVALID_PROPERTIES:${pointer}`);
        for (const [key, child] of Object.entries(properties))
          visit(child, depth + 1, `${pointer}/properties/${key}`);
      }
    }
    if (type === "array" && value.items !== undefined)
      visit(value.items, depth + 1, `${pointer}/items`);
    seen.delete(value);
  };
  visit(schema, 1, "#");
}

export function compilePrimeWorldJsonSchema(
  schema: JsonObject,
): ValidateFunction<JsonValue> {
  assertSafePrimeWorldJsonSchema(schema);
  const key = JSON.stringify(schema);
  const cached = validatorCache.get(key);
  if (cached) return cached;
  const validate = ajv.compile(schema) as ValidateFunction<JsonValue>;
  if (validatorCache.size >= 256) validatorCache.delete(validatorCache.keys().next().value!);
  validatorCache.set(key, validate);
  return validate;
}

export function formatJsonSchemaErrors(validate: ValidateFunction) {
  return (validate.errors ?? [])
    .slice(0, 8)
    .map((issue) => `${issue.instancePath || "/"} ${issue.message ?? "invalid"}`)
    .join("; ");
}
