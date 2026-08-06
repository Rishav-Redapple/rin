import { parse, type AtomicType, type BaseType, type Group, type KeySelector, type RootSchema, type TypeExpression } from "./rin.ts";

export type InputKind = "json" | "rin" | "interface";

class ConverterError extends Error {}

export function detectAndConvert(source: string): { schema: RootSchema; name?: string; kind: InputKind } {
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

export function inferRoot(value: unknown): RootSchema {
  if (isPlainObject(value)) return { kind: "root", container: "object", groups: inferGroups([value]) };
  if (Array.isArray(value)) {
    if (!value.every(isPlainObject)) throw new ConverterError("JSON arrays must contain object records to be represented by RIN");
    return { kind: "root", container: "array", groups: inferGroups(value) };
  }
  throw new ConverterError("JSON root must be an object or an array of object records");
}

export function inferGroups(records: Record<string, unknown>[]): Group[] {
  const keys = new Set<string>();
  records.forEach((record) => Object.keys(record).forEach((key) => keys.add(key)));

  const groupsByType = new Map<string, Group>();

  [...keys].sort().forEach((name) => {
    const present = records.filter((record) => Object.hasOwn(record, name)).map((record) => record[name]);
    const inferred = mergeValues(present.map(inferValue));
    const key: KeySelector = { name, optional: present.length !== records.length, ...(inferred.record ? { record: inferred.record } : {}) };

    const typeSig = renderTypeSig(inferred.type);
    const keySig = inferred.record ? `${typeSig}:${name}` : typeSig;
    const existing = groupsByType.get(keySig);
    if (existing && !key.record) {
      existing.keys.push(key);
    } else {
      groupsByType.set(keySig, { type: inferred.type, keys: [key] });
    }
  });

  return [...groupsByType.values()];
}

function inferValue(value: unknown): { type: TypeExpression; record?: Group[] } {
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

function mergeValues(values: Array<{ type: TypeExpression; record?: Group[] }>): { type: TypeExpression; record?: Group[] } {
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

export function coalesceGroups(groups: Group[]): Group[] {
  const groupsByType = new Map<string, Group>();

  for (const group of groups) {
    const typeSig = renderTypeSig(group.type);
    for (const key of group.keys) {
      const coalescedKey: KeySelector = {
        ...key,
        ...(key.record ? { record: coalesceGroups(key.record) } : {}),
      };

      const keySig = coalescedKey.record ? `${typeSig}:${coalescedKey.name}` : typeSig;
      const existing = groupsByType.get(keySig);
      if (existing && !coalescedKey.record) {
        existing.keys.push(coalescedKey);
      } else {
        groupsByType.set(keySig, { type: group.type, keys: [coalescedKey] });
      }
    }
  }

  return [...groupsByType.values()];
}

function renderTypeSig(type: TypeExpression): string {
  if (type.kind === "union") return type.members.map(renderTypeSig).join("|");
  return `${"A.".repeat(type.arrayDepth)}${type.base}${type.nullable ? "?" : ""}`;
}

function atomic(base: BaseType, arrayDepth = 0, nullable = false): AtomicType {
  return { kind: "atomic", base, arrayDepth, nullable };
}

function withArrayDepth(type: TypeExpression, added: number): TypeExpression {
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => ({ ...member, arrayDepth: member.arrayDepth + added })) };
  return { ...type, arrayDepth: type.arrayDepth + added };
}

export class InterfaceParser {
  private index = 0;
  private readonly tokens: string[];

  constructor(source: string) {
    this.tokens = tokenizeInterface(source);
  }

  parse(): { name: string; groups: Group[] } {
    if (this.take("type")) {
      const name = this.identifier();
      this.expect("=");
      const groups = this.parseMembers();
      this.take(";");
      if (this.peek() !== undefined) throw new ConverterError(`unsupported TypeScript input near '${this.peek()}'`);
      return { name, groups };
    }
    this.expect("interface");
    const name = this.identifier();
    const groups = this.parseMembers();
    if (this.peek() !== undefined) throw new ConverterError(`unsupported TypeScript input near '${this.peek()}'`);
    return { name, groups };
  }

  private parseMembers(): Group[] {
    this.expect("{");
    const groups: Group[] = [];
    while (this.peek() !== "}") {
      if (this.peek() === undefined) throw new ConverterError("unterminated interface body");
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

  private parseType(): { type: TypeExpression; record?: Group[] } {
    const values = [this.parsePrimary()];
    while (this.take("|")) values.push(this.parsePrimary());
    return mergeValues(values);
  }

  private parsePrimary(): { type: TypeExpression; record?: Group[] } {
    let value: { type: TypeExpression; record?: Group[] };
    if (this.take("{")) {
      this.index -= 1;
      value = { type: atomic("O"), record: this.parseMembers() };
    } else {
      const name = this.identifier();
      const base: Record<string, BaseType> = { string: "S", number: "N", boolean: "B", null: "L", unknown: "X", any: "X", object: "O" };
      if (!(name in base)) throw new ConverterError(`unsupported TypeScript type '${name}'`);
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
    if (!this.take(token)) throw new ConverterError(`expected '${token}' in TypeScript interface`);
  }

  private identifier(): string {
    const token = this.peek();
    if (!token || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) throw new ConverterError("expected TypeScript identifier");
    this.index += 1;
    return token;
  }

  private peek(): string | undefined { return this.tokens[this.index]; }
}

function tokenizeInterface(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const tokens = stripped.match(/[A-Za-z_$][A-Za-z0-9_$]*|[{}:;?,|\[\]=]/g);
  if (!tokens || tokens.join("").length !== stripped.replace(/\s/g, "").length) throw new ConverterError("unsupported TypeScript interface syntax");
  return tokens;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
