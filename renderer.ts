import type { AtomicType, BaseType, Group, KeySelector, RootSchema, TypeExpression } from "./rin.ts";
import { coalesceGroups } from "./converter.ts";

export type Target = "json" | "rin" | "type";

export function render(schema: RootSchema, target: Target, name = "Root", pretty = false): string {
  switch (target) {
    case "json":
      return renderJson(schema, pretty);
    case "rin":
      return renderRin(schema, pretty);
    case "type":
      return renderTypeScript(schema, name, pretty);
  }
}

export function renderJson(schema: RootSchema, pretty: boolean): string {
  return pretty ? `${JSON.stringify(schema, null, 2)}\n` : `${JSON.stringify(schema)}\n`;
}

export function renderRin(schema: RootSchema, pretty: boolean): string {
  const open = schema.container === "object" ? ".{" : ".[";
  const close = schema.container === "object" ? "}" : "]";
  const groups = coalesceGroups(schema.groups);

  if (groups.length === 0) return `${open}${close}\n`;

  if (!pretty) {
    return `${open}${groups.map(renderGroupMinimal).join(",")}${close}\n`;
  }

  const lines = groups.map((g) => renderGroupPretty(g, 1));
  return `${open}\n${lines.join(",\n")}\n${close}\n`;
}

function renderGroupMinimal(group: Group): string {
  return `${renderType(group.type)} ${group.keys.map(renderKeyMinimal).join(" ")}`;
}

function renderKeyMinimal(key: KeySelector): string {
  const name = escapeIdentifier(key.name);
  const optional = key.optional ? "?" : "";
  const record = key.record
    ? `{${coalesceGroups(key.record).map(renderGroupMinimal).join(",")}}`
    : "";
  return `${name}${optional}${record}`;
}

function renderGroupPretty(group: Group, level: number): string {
  const indent = "  ".repeat(level);
  const hasRecords = group.keys.some((k) => k.record && k.record.length > 0);

  if (group.type.kind === "atomic" && group.type.base === "O" && hasRecords && group.keys.length > 1) {
    const keyLines = group.keys.map((k) => renderKeyPrettyBlock(k, level + 1));
    return `${indent}${renderType(group.type)}(\n${keyLines.join("\n")}\n${indent})`;
  }

  const keysStr = group.keys.map((k) => renderKeyPrettyInline(k, level)).join(" ");
  return `${indent}${renderType(group.type)} ${keysStr}`;
}

function renderKeyPrettyInline(key: KeySelector, level: number): string {
  const name = escapeIdentifier(key.name);
  const optional = key.optional ? "?" : "";
  if (!key.record) return `${name}${optional}`;

  const indent = "  ".repeat(level);
  const innerGroups = coalesceGroups(key.record);
  if (innerGroups.length === 0) return `${name}${optional}{}`;

  const recordLines = innerGroups.map((g) => renderGroupPretty(g, level + 1));
  return `${name}${optional}{\n${recordLines.join(",\n")}\n${indent}}`;
}

function renderKeyPrettyBlock(key: KeySelector, level: number): string {
  const indent = "  ".repeat(level);
  const name = escapeIdentifier(key.name);
  const optional = key.optional ? "?" : "";
  if (!key.record) return `${indent}${name}${optional}`;

  const innerGroups = coalesceGroups(key.record);
  const recordLines = innerGroups.map((g) => renderGroupPretty(g, level + 1));
  return `${indent}${name}${optional}{\n${recordLines.join(",\n")}\n${indent}}`;
}

function escapeIdentifier(name: string): string {
  if (["S", "N", "B", "L", "X", "O"].includes(name)) return `$${name}`;
  return name;
}

function renderType(type: TypeExpression): string {
  if (type.kind === "union") return type.members.map(renderType).join("|");
  return `${"A.".repeat(type.arrayDepth)}${type.base}${type.nullable ? "?" : ""}`;
}

export function renderTypeScript(schema: RootSchema, name: string, pretty: boolean): string {
  if (!pretty) {
    if (schema.container === "object") return `type ${name}=${renderTsRecordMinimal(schema.groups)};\n`;
    const itemName = `${name}Item`;
    return `type ${itemName}=${renderTsRecordMinimal(schema.groups)};type ${name}=${itemName}[];\n`;
  }

  if (schema.container === "object") return `type ${name} = ${renderTsRecordPretty(schema.groups, 0)};\n`;
  const itemName = `${name}Item`;
  return `type ${itemName} = ${renderTsRecordPretty(schema.groups, 0)};\n\ntype ${name} = ${itemName}[];\n`;
}

function renderTsRecordMinimal(groups: Group[]): string {
  if (groups.length === 0) return "{}";
  const fields = groups.flatMap((g) =>
    g.keys.map((k) => `${k.name}${k.optional ? "?" : ""}:${renderTsTypeMinimal(g.type, k.record)};`)
  );
  return `{${fields.join("")}}`;
}

function renderTsTypeMinimal(type: TypeExpression, record: Group[] | undefined): string {
  if (type.kind === "union") return type.members.map((m) => renderTsAtomicMinimal(m, record)).join("|");
  return renderTsAtomicMinimal(type, record);
}

function renderTsAtomicMinimal(type: AtomicType, record: Group[] | undefined): string {
  const baseMap: Record<BaseType, string> = {
    S: "string",
    N: "number",
    B: "boolean",
    L: "null",
    X: "unknown",
    O: record ? renderTsRecordMinimal(record) : "object",
  };
  let rendered = baseMap[type.base];
  for (let depth = 0; depth < type.arrayDepth; depth += 1) {
    rendered = `${rendered.includes("|") ? `(${rendered})` : rendered}[]`;
  }
  return type.nullable ? `${rendered}|null` : rendered;
}

function renderTsRecordPretty(groups: Group[], level: number): string {
  if (groups.length === 0) return "{}";
  const indent = "  ".repeat(level);
  const inner = "  ".repeat(level + 1);
  const fields = groups.flatMap((g) =>
    g.keys.map((k) => `${inner}${k.name}${k.optional ? "?" : ""}: ${renderTsTypePretty(g.type, k.record, level + 1)};`)
  );
  return `{\n${fields.join("\n")}\n${indent}}`;
}

function renderTsTypePretty(type: TypeExpression, record: Group[] | undefined, level: number): string {
  if (type.kind === "union") return type.members.map((m) => renderTsAtomicPretty(m, record, level)).join(" | ");
  return renderTsAtomicPretty(type, record, level);
}

function renderTsAtomicPretty(type: AtomicType, record: Group[] | undefined, level: number): string {
  const baseMap: Record<BaseType, string> = {
    S: "string",
    N: "number",
    B: "boolean",
    L: "null",
    X: "unknown",
    O: record ? renderTsRecordPretty(record, level) : "object",
  };
  let rendered = baseMap[type.base];
  for (let depth = 0; depth < type.arrayDepth; depth += 1) {
    rendered = `${rendered.includes(" | ") ? `(${rendered})` : rendered}[]`;
  }
  return type.nullable ? `${rendered} | null` : rendered;
}
