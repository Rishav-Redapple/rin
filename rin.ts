/** RIN (Reduced Interface Notation) v3 parser and runtime validator. */

export type BaseType = "S" | "N" | "B" | "L" | "X" | "O";

export interface AtomicType {
  kind: "atomic";
  base: BaseType;
  arrayDepth: number;
  nullable: boolean;
}

export interface UnionType {
  kind: "union";
  members: AtomicType[];
}

export type TypeExpression = AtomicType | UnionType;
export type TypeExpr = TypeExpression;

export interface KeySelector {
  name: string;
  optional: boolean;
  record?: Group[];
}
export type Key = KeySelector;

export interface Group {
  type: TypeExpression;
  keys: KeySelector[];
}

export interface RootSchema {
  kind: "root";
  container: "object" | "array";
  groups: Group[];
  name?: string;
}

export interface ValidationIssue {
  path: string;
  expected: string;
  received: string;
  message: string;
}

export type ValidationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationIssue[] };

export class RinSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(`${message} at character ${position}`);
    this.name = "RinSyntaxError";
  }
}

interface Token { value: string; position: number; }

const primitiveNames: Record<string, BaseType> = {
  String: "S", Number: "N", Boolean: "B", Null: "L", Any: "X",
};

class Parser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(source: string) { this.tokens = tokenize(source); }

  parse(): RootSchema {
    this.skipSeparators();
    let container: RootSchema["container"];
    let name: string | undefined;
    if (this.take("{")) container = "object";
    else if (this.take("[")) { container = "array"; this.expect("{"); }
    else {
      name = this.identifier();
      if (this.take("{")) container = "object";
      else if (this.take("[")) { container = "array"; this.expect("{"); }
      else this.fail("Expected '{' or '[{' after root name");
    }
    const groups = this.parseGroups("}");
    this.expect("}");
    if (container === "array") this.expect("]");
    this.skipSeparators();
    if (this.peek()) this.fail("Unexpected trailing input");
    return { kind: "root", container, groups, ...(name ? { name } : {}) };
  }

  private parseGroups(end: string): Group[] {
    const groups: Group[] = [];
    this.skipSeparators();
    while (this.peek()?.value !== end) {
      if (!this.peek()) this.fail(`Expected '${end}'`);
      groups.push(this.parseGroup());
      if (this.peek()?.value === end) break;
      if (!this.skipSeparators()) this.fail("Expected a new line, ',' or ';' between groups");
    }
    return groups;
  }

  private parseGroup(): Group {
    const first = this.identifier();
    const base = primitiveNames[first];
    if (!base) {
      let arrayDepth = 0;
      while (this.take("[]")) arrayDepth += 1;
      const optional = this.take("?");
      this.expect("{");
      const record = this.parseGroups("}");
      this.expect("}");
      return { type: { kind: "atomic", base: "O", arrayDepth, nullable: false }, keys: [{ name: first, optional, record }] };
    }

    const members = [this.parseAtomicTail(base)];
    while (this.take("|")) {
      const name = this.identifier();
      const unionBase = primitiveNames[name];
      if (!unionBase) this.fail("Expected a primitive name after '|'");
      members.push(this.parseAtomicTail(unionBase));
    }
    const keys: KeySelector[] = [];
    while (this.peek() && !isBoundary(this.peek()!.value)) {
      const name = this.identifier();
      const optional = this.take("?");
      if (this.peek()?.value === "{") this.fail("Object fields must start with their key name, not a primitive type");
      keys.push({ name, optional });
    }
    if (keys.length === 0) this.fail("Expected one or more keys after primitive type");
    return { type: members.length === 1 ? members[0]! : { kind: "union", members }, keys };
  }

  private parseAtomicTail(base: BaseType): AtomicType {
    let arrayDepth = 0;
    while (this.take("[]")) arrayDepth += 1;
    return { kind: "atomic", base, arrayDepth, nullable: false };
  }

  private identifier(): string {
    const token = this.peek();
    if (!token || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(token.value)) this.fail("Expected identifier");
    this.index += 1;
    return token.value;
  }

  private take(value: string): boolean {
    if (this.peek()?.value !== value) return false;
    this.index += 1;
    return true;
  }

  private expect(value: string): void {
    if (!this.take(value)) this.fail(`Expected '${value}'`);
  }

  private peek(): Token | undefined { return this.tokens[this.index]; }

  private skipSeparators(): boolean {
    let skipped = false;
    while (["\n", ",", ";"].includes(this.peek()?.value ?? "")) { this.index += 1; skipped = true; }
    return skipped;
  }

  private fail(message: string): never {
    throw new RinSyntaxError(message, this.peek()?.position ?? this.tokens.at(-1)?.position ?? 0);
  }
}

function isBoundary(value: string): boolean { return value === "}" || value === "\n" || value === "," || value === ";"; }

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let position = 0; position < source.length;) {
    const rest = source.slice(position);
    if (rest.startsWith("#")) { const newline = rest.search(/\r?\n/); position += newline < 0 ? rest.length : newline; continue; }
    if (rest.startsWith("\r\n")) { tokens.push({ value: "\n", position }); position += 2; continue; }
    if (rest[0] === "\n") { tokens.push({ value: "\n", position }); position += 1; continue; }
    if (/^[ \t\r]/.test(rest)) { position += 1; continue; }
    if (rest.startsWith("[]")) { tokens.push({ value: "[]", position }); position += 2; continue; }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (identifier) { tokens.push({ value: identifier[0], position }); position += identifier[0].length; continue; }
    if ("{}[]?|,;".includes(rest[0]!)) { tokens.push({ value: rest[0]!, position }); position += 1; continue; }
    throw new RinSyntaxError(`Unexpected character '${rest[0]}'`, position);
  }
  return tokens;
}

/** Parses a RIN schema string into its syntax tree. */
export function parse(source: string): RootSchema {
  return new Parser(source).parse();
}

/** Validates a value against a RIN schema or schema string. */
export function validate<T = unknown>(schema: RootSchema | string, value: T): ValidationResult<T> {
  const root = typeof schema === "string" ? parse(schema) : schema;
  const errors: ValidationIssue[] = [];

  if (root.container === "object") {
    if (!isPlainObject(value)) {
      addIssue(errors, "$", "object", value);
    } else {
      validateGroups(root.groups, value, "$", errors);
    }
  } else if (!Array.isArray(value)) {
    addIssue(errors, "$", "array", value);
  } else {
    value.forEach((item, index) => {
      const path = `$[${index}]`;
      if (!isPlainObject(item)) addIssue(errors, path, "object", item);
      else validateGroups(root.groups, item, path, errors);
    });
  }

  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

function validateGroups(groups: Group[], value: Record<string, unknown>, path: string, errors: ValidationIssue[]): void {
  for (const group of groups) {
    for (const key of group.keys) {
      if (!(key.name in value) || value[key.name] === undefined) {
        if (!key.optional) addIssue(errors, propertyPath(path, key.name), typeLabel(group.type), undefined, "is required");
        continue;
      }
      if (value[key.name] === null && key.optional) continue;
      validateType(group.type, value[key.name], propertyPath(path, key.name), key.record, errors);
    }
  }
}

function validateType(
  type: TypeExpression,
  value: unknown,
  path: string,
  record: Group[] | undefined,
  errors: ValidationIssue[],
): void {
  if (type.kind === "union") {
    const candidates = type.members.map((member) => {
      const candidateErrors: ValidationIssue[] = [];
      validateAtomic(member, value, path, record, candidateErrors);
      return candidateErrors;
    });
    if (candidates.some((candidate) => candidate.length === 0)) return;
    addIssue(errors, path, typeLabel(type), value, `did not match any union member`);
    return;
  }
  validateAtomic(type, value, path, record, errors);
}

function validateAtomic(
  type: AtomicType,
  value: unknown,
  path: string,
  record: Group[] | undefined,
  errors: ValidationIssue[],
): void {
  if (value === null && type.nullable) return;
  validateArrayLayers(type, type.arrayDepth, value, path, record, errors);
}

function validateArrayLayers(
  type: AtomicType,
  remainingDepth: number,
  value: unknown,
  path: string,
  record: Group[] | undefined,
  errors: ValidationIssue[],
): void {
  if (remainingDepth > 0) {
    if (!Array.isArray(value)) {
      addIssue(errors, path, typeLabel(type), value);
      return;
    }
    value.forEach((item, index) => validateArrayLayers(type, remainingDepth - 1, item, `${path}[${index}]`, record, errors));
    return;
  }

  if (!matchesBase(type.base, value)) {
    addIssue(errors, path, typeLabel(type), value);
    return;
  }
  if (record && isPlainObject(value)) validateGroups(record, value, path, errors);
}

function matchesBase(base: BaseType, value: unknown): boolean {
  switch (base) {
    case "S": return typeof value === "string";
    case "N": return typeof value === "number" && !Number.isNaN(value);
    case "B": return typeof value === "boolean";
    case "L": return value === null;
    case "X": return true;
    case "O": return isPlainObject(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function typeLabel(type: TypeExpression): string {
  if (type.kind === "union") return type.members.map(typeLabel).join(" | ");
  return `${"A.".repeat(type.arrayDepth)}${type.base}${type.nullable ? "?" : ""}`;
}

function propertyPath(path: string, key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function receivedLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function addIssue(
  errors: ValidationIssue[],
  path: string,
  expected: string,
  value: unknown,
  suffix = "has an invalid value",
): void {
  const received = receivedLabel(value);
  errors.push({ path, expected, received, message: `${path} ${suffix}; expected ${expected}, received ${received}` });
}
