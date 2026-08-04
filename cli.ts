#!/usr/bin/env bun

import { parse, type AtomicType, type BaseType, type Group, type KeySelector, type RootSchema, type TypeExpression } from "./rin.ts";

type Target = "json" | "rin" | "type";
type InputKind = "json" | "rin" | "interface";

interface Options {
  output?: string;
  positional?: string;
  target: Target;
}

interface InferredValue {
  type: TypeExpression;
  record?: Group[];
}

class CliError extends Error {}

/** Executes the RIN CLI. Exported to make embedding and tests straightforward. */
export async function run(argv: string[], stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number; output?: string }> {
  try {
    const options = parseArguments(argv);
    if (options.positional !== undefined && stdin.trim() !== "") {
      throw new CliError("provide input through stdin or a positional argument, not both");
    }
    const source = options.positional ?? stdin;
    if (source.trim() === "") throw new CliError("no input provided");
    const { schema, name } = detectAndConvert(source);
    const output = render(schema, options.target, name);
    return { stdout: options.output ? "" : output, stderr: "", exitCode: 0, output: options.output ? output : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `rin: ${message}\n`, exitCode: 1 };
  }
}

function parseArguments(argv: string[]): Options {
  let output: string | undefined;
  let target: Target = "rin";
  let positional: string | undefined;
  let targetSet = false;

  const setTarget = (value: string): void => {
    if (value !== "json" && value !== "rin" && value !== "type") throw new CliError(`invalid output format '${value}' (expected json, rin, or type)`);
    if (targetSet && target !== value) throw new CliError("conflicting output format flags");
    target = value;
    targetSet = true;
  };
  const takeValue = (flag: string, index: number): [string, number] => {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new CliError(`missing value for ${flag}`);
    return [value, index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      const rest = argv.slice(index + 1);
      if (rest.length !== 1 || positional !== undefined) throw new CliError("expected at most one positional input");
      positional = rest[0]!;
      break;
    }
    if (arg === "-o" || arg === "--output") {
      const [value, next] = takeValue(arg, index);
      if (output !== undefined) throw new CliError("output was specified more than once");
      output = value;
      index = next;
    } else if (arg.startsWith("--output=")) {
      if (output !== undefined || arg.slice(9) === "") throw new CliError("output was specified more than once or is empty");
      output = arg.slice(9);
    } else if (arg === "-t" || arg === "--to") {
      const [value, next] = takeValue(arg, index);
      setTarget(value);
      index = next;
    } else if (arg.startsWith("--to=")) {
      setTarget(arg.slice(5));
    } else if (arg === "-J" || arg === "--to-json") {
      setTarget("json");
    } else if (arg === "-R" || arg === "--to-rin") {
      setTarget("rin");
    } else if (arg === "-T" || arg === "--to-type") {
      setTarget("type");
    } else if (arg.startsWith("-")) {
      throw new CliError(`unknown flag '${arg}'`);
    } else if (positional === undefined) {
      positional = arg;
    } else {
      throw new CliError("expected at most one positional input");
    }
  }
  return { output, positional, target };
}

function detectAndConvert(source: string): { schema: RootSchema; name?: string; kind: InputKind } {
  const trimmed = source.trim();
  if (trimmed.startsWith(".")) return { schema: parse(trimmed), kind: "rin" };
  try {
    return { schema: inferRoot(JSON.parse(trimmed)), kind: "json" };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const parsed = new InterfaceParser(trimmed).parse();
  return { schema: { kind: "root", container: "object", groups: parsed.groups }, name: parsed.name, kind: "interface" };
}

function inferRoot(value: unknown): RootSchema {
  if (isPlainObject(value)) return { kind: "root", container: "object", groups: inferGroups([value]) };
  if (Array.isArray(value)) {
    if (!value.every(isPlainObject)) throw new CliError("JSON arrays must contain object records to be represented by RIN");
    return { kind: "root", container: "array", groups: inferGroups(value) };
  }
  throw new CliError("JSON root must be an object or an array of object records");
}

function inferGroups(records: Record<string, unknown>[]): Group[] {
  const keys = new Set<string>();
  records.forEach((record) => Object.keys(record).forEach((key) => keys.add(key)));
  return [...keys].sort().map((name) => {
    const present = records.filter((record) => Object.hasOwn(record, name)).map((record) => record[name]);
    const inferred = mergeValues(present.map(inferValue));
    const key: KeySelector = { name, optional: present.length !== records.length, ...(inferred.record ? { record: inferred.record } : {}) };
    return { type: inferred.type, keys: [key] };
  });
}

function inferValue(value: unknown): InferredValue {
  if (value === null) return { type: atomic("L") };
  if (typeof value === "string") return { type: atomic("S") };
  if (typeof value === "number") return { type: atomic("N") };
  if (typeof value === "boolean") return { type: atomic("B") };
  if (isPlainObject(value)) return { type: atomic("O"), record: inferGroups([value]) };
  if (Array.isArray(value)) {
    const element = value.length === 0 ? { type: atomic("X") } : mergeValues(value.map(inferValue));
    return { type: withArrayDepth(element.type, 1), ...(element.record ? { record: element.record } : {}) };
  }
  return { type: atomic("X") };
}

function mergeValues(values: InferredValue[]): InferredValue {
  const recordValues = values.filter((value) => value.record).map((value) => value.record!);
  const record = recordValues.length === 0 ? undefined : mergeRecordGroups(recordValues);
  const atoms = values.flatMap((value) => value.type.kind === "union" ? value.type.members : [value.type]);
  const hasNull = atoms.some((value) => value.base === "L");
  const withoutNull = atoms.filter((value) => value.base !== "L");
  if (withoutNull.length === 0) return { type: atomic("L"), ...(record ? { record } : {}) };
  const deduped = new Map<string, AtomicType>();
  for (const value of withoutNull) {
    const candidate = { ...value, nullable: value.nullable || hasNull };
    deduped.set(`${candidate.base}:${candidate.arrayDepth}:${candidate.nullable}`, candidate);
  }
  const members = [...deduped.values()];
  return { type: members.length === 1 ? members[0]! : { kind: "union", members }, ...(record ? { record } : {}) };
}

function mergeRecordGroups(groupSets: Group[][]): Group[] {
  const byName = new Map<string, Array<{ group: Group; key: KeySelector }>>();
  for (const groups of groupSets) {
    for (const group of groups) for (const key of group.keys) {
      const entries = byName.get(key.name) ?? [];
      entries.push({ group, key });
      byName.set(key.name, entries);
    }
  }
  return [...byName.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, entries]) => {
    const inferred = mergeValues(entries.map(({ group, key }) => ({ type: group.type, ...(key.record ? { record: key.record } : {}) })));
    const optional = entries.length !== groupSets.length || entries.some(({ key }) => key.optional);
    return { type: inferred.type, keys: [{ name, optional, ...(inferred.record ? { record: inferred.record } : {}) }] };
  });
}

function atomic(base: BaseType, arrayDepth = 0, nullable = false): AtomicType {
  return { kind: "atomic", base, arrayDepth, nullable };
}

function withArrayDepth(type: TypeExpression, added: number): TypeExpression {
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => ({ ...member, arrayDepth: member.arrayDepth + added })) };
  return { ...type, arrayDepth: type.arrayDepth + added };
}

function render(schema: RootSchema, target: Target, name?: string): string {
  switch (target) {
    case "json": return `${JSON.stringify(schema, null, 2)}\n`;
    case "rin": return `${renderRin(schema)}\n`;
    case "type": return `${renderTypeScript(schema, name ?? "Root")}\n`;
  }
}

function renderRin(schema: RootSchema): string {
  return `.${schema.container === "object" ? "{" : "["}${schema.groups.map(renderGroup).join(",")}${schema.container === "object" ? "}" : "]"}`;
}

function renderGroup(group: Group): string {
  return `${renderType(group.type)}(${group.keys.map(renderKey).join("")})`;
}

function renderKey(key: KeySelector): string {
  return `.${key.name}${key.optional ? "?" : ""}${key.record ? `{${key.record.map(renderGroup).join(",")}}` : ""}`;
}

function renderType(type: TypeExpression): string {
  if (type.kind === "union") return type.members.map(renderType).join("|");
  return `${"A.".repeat(type.arrayDepth)}${type.base}${type.nullable ? "?" : ""}`;
}

function renderTypeScript(schema: RootSchema, name: string): string {
  if (schema.container === "object") return `interface ${name} ${renderRecordType(schema.groups, 0)}`;
  const itemName = `${name}Item`;
  return `interface ${itemName} ${renderRecordType(schema.groups, 0)}\n\ntype ${name} = ${itemName}[];`;
}

function renderRecordType(groups: Group[], level: number): string {
  if (groups.length === 0) return "{}";
  const indent = "  ".repeat(level);
  const inner = "  ".repeat(level + 1);
  const fields = groups.flatMap((group) => group.keys.map((key) => `${inner}${key.name}${key.optional ? "?" : ""}: ${renderTsType(group.type, key.record, level + 1)};`));
  return `{\n${fields.join("\n")}\n${indent}}`;
}

function renderTsType(type: TypeExpression, record: Group[] | undefined, level: number): string {
  if (type.kind === "union") return type.members.map((member) => renderTsAtomic(member, record, level)).join(" | ");
  return renderTsAtomic(type, record, level);
}

function renderTsAtomic(type: AtomicType, record: Group[] | undefined, level: number): string {
  const base: Record<BaseType, string> = { S: "string", N: "number", B: "boolean", L: "null", X: "unknown", O: record ? renderRecordType(record, level) : "object" };
  let rendered = base[type.base];
  for (let depth = 0; depth < type.arrayDepth; depth += 1) rendered = `${rendered.includes(" | ") ? `(${rendered})` : rendered}[]`;
  return type.nullable ? `${rendered} | null` : rendered;
}

class InterfaceParser {
  private index = 0;
  private readonly tokens: string[];

  constructor(source: string) {
    this.tokens = tokenizeInterface(source);
  }

  parse(): { name: string; groups: Group[] } {
    this.expect("interface");
    const name = this.identifier();
    const groups = this.parseMembers();
    if (this.peek() !== undefined) throw new CliError(`unsupported TypeScript input near '${this.peek()}'`);
    return { name, groups };
  }

  private parseMembers(): Group[] {
    this.expect("{");
    const groups: Group[] = [];
    while (this.peek() !== "}") {
      if (this.peek() === undefined) throw new CliError("unterminated interface body");
      const name = this.identifier();
      const optional = this.take("?");
      this.expect(":");
      const value = this.parseType();
      groups.push({ type: value.type, keys: [{ name, optional, ...(value.record ? { record: value.record } : {}) }] });
      this.take(";") || this.take(",");
    }
    this.expect("}");
    return groups;
  }

  private parseType(): InferredValue {
    const values = [this.parsePrimary()];
    while (this.take("|")) values.push(this.parsePrimary());
    return mergeValues(values);
  }

  private parsePrimary(): InferredValue {
    let value: InferredValue;
    if (this.take("{")) {
      this.index -= 1;
      value = { type: atomic("O"), record: this.parseMembers() };
    } else {
      const name = this.identifier();
      const base: Record<string, BaseType> = { string: "S", number: "N", boolean: "B", null: "L", unknown: "X", any: "X", object: "O" };
      if (!(name in base)) throw new CliError(`unsupported TypeScript type '${name}'`);
      value = { type: atomic(base[name]!) };
    }
    while (this.take("[")) {
      this.expect("]");
      value = { type: withArrayDepth(value.type, 1), ...(value.record ? { record: value.record } : {}) };
    }
    return value;
  }

  private take(token: string): boolean {
    if (this.peek() !== token) return false;
    this.index += 1;
    return true;
  }

  private expect(token: string): void {
    if (!this.take(token)) throw new CliError(`expected '${token}' in TypeScript interface`);
  }

  private identifier(): string {
    const token = this.peek();
    if (!token || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) throw new CliError("expected TypeScript identifier");
    this.index += 1;
    return token;
  }

  private peek(): string | undefined { return this.tokens[this.index]; }
}

function tokenizeInterface(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const tokens = stripped.match(/[A-Za-z_$][A-Za-z0-9_$]*|[{}:;?,|\[\]]/g);
  if (!tokens || tokens.join("").length !== stripped.replace(/\s/g, "").length) throw new CliError("unsupported TypeScript interface syntax");
  return tokens;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let stdin = "";
  try {
    const options = parseArguments(argv);
    stdin = options.positional !== undefined && process.stdin.isTTY ? "" : await Bun.stdin.text();
  } catch {
    // run() formats argument errors consistently; it will parse the arguments again.
  }
  const result = await run(argv, stdin);
  if (result.output !== undefined) {
    try {
      await Bun.write(parseArguments(argv).output!, result.output);
    } catch (error) {
      process.stderr.write(`rin: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(result.stdout);
  }
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
