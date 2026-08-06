/** RIN (Reduced Interface Notation) v2 parser and runtime validator. */

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

class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): RootSchema {
    this.skipWhitespaceAndNewlines();
    this.expect(".");
    const container = this.consume("{") ? "object" : this.consume("[") ? "array" : undefined;
    if (!container) this.fail("Expected '{' or '[' after root marker");

    const end = container === "object" ? "}" : "]";
    const groups = this.parseGroupList(end);
    this.expect(end);
    this.skipWhitespaceAndNewlines();
    if (this.position !== this.source.length) this.fail("Unexpected trailing input");
    return { kind: "root", container, groups };
  }

  private parseGroupList(end: string): Group[] {
    const groups: Group[] = [];
    this.skipWhitespaceAndNewlines();
    while (this.position < this.source.length && this.peek() !== end) {
      groups.push(this.parseGroup());
      this.skipHorizontalWhitespace();
      if (this.consume(",")) {
        this.skipWhitespaceAndNewlines();
      } else {
        this.skipWhitespaceAndNewlines();
      }
      if (this.peek() === end) break;
    }
    return groups;
  }

  private parseGroup(): Group {
    const type = this.parseTypeExpression();
    this.skipHorizontalWhitespace();
    if (this.consume("(")) {
      const keys = this.parseBlockKeys();
      this.expect(")");
      return { type, keys };
    }

    const keys: KeySelector[] = [];
    while (this.isIdentifierStart()) {
      keys.push(this.parseKey());
      this.skipHorizontalWhitespace();
    }
    if (keys.length === 0) {
      this.fail("Expected key identifier or '(' for group");
    }
    return { type, keys };
  }

  private parseBlockKeys(): KeySelector[] {
    const keys: KeySelector[] = [];
    this.skipWhitespaceAndNewlines();
    while (this.position < this.source.length && this.peek() !== ")") {
      keys.push(this.parseKey());
      this.skipHorizontalWhitespace();
      this.consume(",");
      this.skipWhitespaceAndNewlines();
    }
    return keys;
  }

  private parseTypeExpression(): TypeExpression {
    const members = [this.parseAtomicType()];
    while (this.consume("|")) members.push(this.parseAtomicType());
    return members.length === 1 ? members[0]! : { kind: "union", members };
  }

  private parseAtomicType(): AtomicType {
    let arrayDepth = 0;
    while (this.consume("A.")) arrayDepth += 1;
    this.skipHorizontalWhitespace();
    const candidate = this.source[this.position];
    if (!candidate || !["S", "N", "B", "L", "X", "O"].includes(candidate)) {
      this.fail("Expected base type (S, N, B, L, X, or O)");
    }
    this.position += 1;
    return {
      kind: "atomic",
      base: candidate as BaseType,
      arrayDepth,
      nullable: this.consume("?"),
    };
  }

  private parseKey(): KeySelector {
    const name = this.parseIdentifier();
    const optional = this.consume("?");
    let record: Group[] | undefined;
    this.skipHorizontalWhitespace();
    if (this.consume("{")) {
      record = this.parseGroupList("}");
      this.expect("}");
    }
    return { name, optional, ...(record === undefined ? {} : { record }) };
  }

  private isIdentifierStart(): boolean {
    this.skipHorizontalWhitespace();
    const ch = this.source[this.position];
    if (!ch) return false;
    return ch === "$" || /[a-zA-Z_]/.test(ch);
  }

  private parseIdentifier(): string {
    this.skipHorizontalWhitespace();
    const match = /^\$?([a-zA-Z_][a-zA-Z0-9_]*)/.exec(this.source.slice(this.position));
    if (!match) this.fail("Expected identifier");
    this.position += match[0].length;
    return match[1]!;
  }

  private consume(token: string): boolean {
    this.skipHorizontalWhitespace();
    if (!this.source.startsWith(token, this.position)) return false;
    this.position += token.length;
    return true;
  }

  private expect(token: string): void {
    if (!this.consume(token)) this.fail(`Expected '${token}'`);
  }

  private peek(): string | undefined {
    return this.source[this.position];
  }

  private skipHorizontalWhitespace(): void {
    while (/[ \t]/.test(this.source[this.position] ?? "")) this.position += 1;
  }

  private skipWhitespaceAndNewlines(): void {
    while (/\s/.test(this.source[this.position] ?? "")) this.position += 1;
  }

  private fail(message: string): never {
    throw new RinSyntaxError(message, this.position);
  }
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

