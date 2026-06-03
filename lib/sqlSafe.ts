import { sql, type SQL } from "drizzle-orm";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function fail(name: string, value: unknown): never {
  throw new Error(`Unsafe SQL literal for ${name}: ${String(value)}`);
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function rawInteger(value: number, name = "integer"): SQL {
  if (!Number.isSafeInteger(value)) fail(name, value);
  return sql.raw(String(value));
}

export function rawNonNegativeInteger(value: number, name = "integer"): SQL {
  if (!Number.isSafeInteger(value) || value < 0) fail(name, value);
  return sql.raw(String(value));
}

export function rawPositiveInteger(value: number, name = "integer"): SQL {
  if (!Number.isSafeInteger(value) || value < 1) fail(name, value);
  return sql.raw(String(value));
}

export function rawFiniteNumber(
  value: number,
  name = "number",
  opts: { min?: number; max?: number } = {},
): SQL {
  if (!Number.isFinite(value)) fail(name, value);
  if (opts.min != null && value < opts.min) fail(name, value);
  if (opts.max != null && value > opts.max) fail(name, value);
  return sql.raw(String(value));
}

export function rawNumericString(value: string, name = "numeric string"): SQL {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) fail(name, value);
  return sql.raw(`${quoteSqlString(value)}::numeric`);
}

export function rawDateLiteral(value: string, name = "date"): SQL {
  if (!DATE_RE.test(value)) fail(name, value);
  return sql.raw(`DATE ${quoteSqlString(value)}`);
}

export function rawSqlFragment(
  fragment: string,
  allowed: readonly string[],
  name = "SQL fragment",
): SQL {
  if (!allowed.includes(fragment)) fail(name, fragment);
  return sql.raw(fragment);
}

export function rawStringLiteralList(
  values: readonly string[],
  isAllowed: (value: string) => boolean,
  name = "string list",
): SQL {
  if (values.length === 0) fail(name, "empty list");
  const quoted = values.map((value) => {
    if (!isAllowed(value)) fail(name, value);
    return quoteSqlString(value);
  });
  return sql.raw(quoted.join(","));
}

export function rawTextValuesSelect(
  values: readonly string[],
  columnAlias: string,
  isAllowed: (value: string) => boolean,
  name = "text values select",
): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(columnAlias)) fail(name, columnAlias);
  if (values.length === 0) fail(name, "empty list");
  const rows = values.map((value) => {
    if (!isAllowed(value)) fail(name, value);
    return `(${quoteSqlString(value)})`;
  });
  return sql.raw(`SELECT ${columnAlias} FROM (VALUES ${rows.join(",")}) AS v(${columnAlias})`);
}

export function rawAddressList(
  values: readonly string[],
  name = "address list",
): SQL {
  return rawStringLiteralList(
    values.map((value) => value.toLowerCase()),
    (value) => ADDRESS_RE.test(value),
    name,
  );
}
