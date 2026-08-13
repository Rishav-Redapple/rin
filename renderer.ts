import type { AtomicType, BaseType, Group, KeySelector, RootSchema, TypeExpression } from "./rin.ts";
import { coalesceGroups } from "./converter.ts";

export type Target = "json" | "rin" | "type" | "go";

const names: Record<BaseType, string> = {
  S: "String", N: "Number", B: "Boolean", L: "Null", X: "Any", O: "Object",
};

export function render(schema: RootSchema, target: Target, name: string | undefined = undefined, pretty = false): string {
  if (target === "json") return `${JSON.stringify(exampleValue(schema), null, pretty ? 2 : undefined)}\n`;
  if (target === "rin") return renderRin(schema, pretty, name);
  if (target === "type") return renderTypeScript(schema, name ?? "Root", pretty);
  return renderGo(schema, name ?? "Root", pretty);
}

export function renderRin(schema: RootSchema, pretty: boolean, name?: string): string {
  const groups = coalesceGroups(schema.groups);
  const body = renderRecord(groups, pretty, 0);
  return `${name ? `${name} ` : ""}${schema.container === "array" ? `[${body}]` : body}\n`;
}

function renderRecord(groups: Group[], pretty: boolean, level: number): string {
  if (groups.length === 0) return "{}";
  const rendered = groups.flatMap((group) => renderGroup(group, pretty, level));
  if (!pretty) return `{${rendered.join(";")}}`;
  const indent = "  ".repeat(level);
  const inner = "  ".repeat(level + 1);
  return `{\n${rendered.map((line) => `${inner}${line}`).join("\n")}\n${indent}}`;
}

function renderGroup(group: Group, pretty: boolean, level: number): string[] {
  const keys = group.keys;
  if (isObjectGroup(group)) {
    return keys.map((key) => `${key.name}${"[]".repeat(arrayDepth(group.type))}${key.optional ? "?" : ""}${renderRecord(coalesceGroups(key.record ?? []), pretty, level + 1)}`);
  }
  return [`${renderType(group.type)} ${keys.map((key) => `${key.name}${key.optional || isNullable(group.type) ? "?" : ""}`).join(" ")}`];
}

function isObjectGroup(group: Group): boolean {
  return group.type.kind === "atomic" && group.type.base === "O";
}

function renderType(type: TypeExpression): string {
  if (type.kind === "union") return type.members.map(renderAtomic).join("|");
  return renderAtomic(type);
}

function renderAtomic(type: AtomicType): string { return `${names[type.base]}${"[]".repeat(type.arrayDepth)}`; }
function arrayDepth(type: TypeExpression): number { return type.kind === "atomic" ? type.arrayDepth : 0; }
function isNullable(type: TypeExpression): boolean { return type.kind === "atomic" && type.nullable; }

export function renderTypeScript(schema: RootSchema, name: string, pretty: boolean): string {
  if (schema.container === "object") return pretty ? `type ${name} = ${renderTsRecord(schema.groups, 0, true)};\n` : `type ${name}=${renderTsRecord(schema.groups, 0, false)};\n`;
  const item = `${name}Item`;
  if (!pretty) return `type ${item}=${renderTsRecord(schema.groups, 0, false)};type ${name}=${item}[];\n`;
  return `type ${item} = ${renderTsRecord(schema.groups, 0, true)};\n\ntype ${name} = ${item}[];\n`;
}

function renderTsRecord(groups: Group[], level: number, pretty: boolean): string {
  if (groups.length === 0) return "{}";
  const fields = groups.flatMap((group) => group.keys.map((key) => {
    const type = renderTsType(group.type, key.record, level + 1, pretty);
    const nullable = key.optional && !type.includes("null") ? `${type}${pretty ? " | " : "|"}null` : type;
    return `${key.name}${key.optional ? "?" : ""}:${nullable};`;
  }));
  if (!pretty) return `{${fields.join("")}}`;
  const indent = "  ".repeat(level);
  const inner = "  ".repeat(level + 1);
  return `{\n${fields.map((field) => `${inner}${field.replace(":", ": ")}`).join("\n")}\n${indent}}`;
}

function renderTsType(type: TypeExpression, record: Group[] | undefined, level: number, pretty: boolean): string {
  if (type.kind === "union") return type.members.map((member) => renderTsAtomic(member, record, level, pretty)).join(" | ");
  return renderTsAtomic(type, record, level, pretty);
}

function renderTsAtomic(type: AtomicType, record: Group[] | undefined, level: number, pretty: boolean): string {
  let value = type.base === "O" ? (record ? renderTsRecord(record, level, pretty) : "object") : ({ S: "string", N: "number", B: "boolean", L: "null", X: "any" } as const)[type.base];
  for (let depth = 0; depth < type.arrayDepth; depth += 1) value = `${value.includes("|") ? `(${value})` : value}[]`;
  return type.nullable ? `${value}${pretty ? " | " : "|"}null` : value;
}

function exampleValue(schema: RootSchema): unknown {
  const object = exampleRecord(schema.groups);
  return schema.container === "array" ? [object] : object;
}

function exampleRecord(groups: Group[]): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const group of groups) for (const key of group.keys) value[key.name] = exampleType(group.type, key.record);
  return value;
}

function exampleType(type: TypeExpression, record?: Group[]): unknown {
  const atomic = type.kind === "union" ? type.members[0]! : type;
  let value: unknown;
  switch (atomic.base) {
    case "S": value = ""; break;
    case "N": value = 0; break;
    case "B": value = false; break;
    case "L": value = null; break;
    case "X": value = null; break;
    case "O": value = record ? exampleRecord(record) : {}; break;
  }
  for (let index = 0; index < atomic.arrayDepth; index += 1) value = [value];
  return value;
}

export function renderGo(schema: RootSchema, name: string, pretty: boolean): string {
  if (schema.container === "object") return `type ${name} ${renderGoRecord(schema.groups, 0, pretty)}\n`;
  const item = `${name}Item`;
  if (!pretty) return `type ${item} ${renderGoRecord(schema.groups, 0, false)};type ${name} []${item}\n`;
  return `type ${item} ${renderGoRecord(schema.groups, 0, true)}\n\ntype ${name} []${item}\n`;
}

function renderGoRecord(groups: Group[], level: number, pretty: boolean): string {
  const fields = groups.flatMap((group) => group.keys.map((key) => renderGoField(key, group.type, level + 1, pretty)));
  if (!pretty) return `struct{${fields.join(";")}}`;
  if (fields.length === 0) return "struct{}";
  const indent = "  ".repeat(level);
  const inner = "  ".repeat(level + 1);
  return `struct {\n${fields.map((field) => `${inner}${field}`).join("\n")}\n${indent}}`;
}

function renderGoField(key: KeySelector, type: TypeExpression, level: number, pretty: boolean): string {
  const value = renderGoType(type, key.record, level, pretty);
  const optional = key.optional && !value.startsWith("*") ? `*${value}` : value;
  const tag = key.optional ? `json:"${key.name},omitempty"` : `json:"${key.name}"`;
  return `${goFieldName(key.name)} ${optional} \`${tag}\``;
}

function renderGoType(type: TypeExpression, record: Group[] | undefined, level: number, pretty: boolean): string {
  if (type.kind === "union") return "any";
  if (type.base === "L" || type.base === "X") return "any";
  let value: string;
  if (type.base === "O") value = record ? renderGoRecord(record, level, pretty) : "map[string]any";
  else value = ({ S: "string", N: "float64", B: "bool" } as const)[type.base];
  for (let depth = 0; depth < type.arrayDepth; depth += 1) value = `[]${value}`;
  return type.nullable ? `*${value}` : value;
}

function goFieldName(name: string): string {
  const parts = name.match(/[A-Za-z0-9]+/g) ?? [];
  const rendered = parts.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("") || "Field";
  return /^[A-Za-z]/.test(rendered) ? rendered : `Field${rendered}`;
}
