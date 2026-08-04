/** RIN (Reduced Interface Notation) parser and runtime validator. */

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

export interface KeySelector {
  name: string;
  optional: boolean;
  record?: Group[];
}

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
    this.expect(".");
    const container = this.consume("{") ? "object" : this.consume("[") ? "array" : undefined;
    if (!container) this.fail("Expected '{' or '[' after root marker");

    const end = container === "object" ? "}" : "]";
    let groups: Group[];
    if (this.consume(end)) {
      groups = [];
    } else {
      groups = this.parseGroupList(end);
      this.expect(end);
    }
    this.skipWhitespace();
    if (this.position !== this.source.length) this.fail("Unexpected trailing input");
    return { kind: "root", container, groups };
  }

  private parseGroupList(end: string): Group[] {
    const groups = [this.parseGroup()];
    while (this.consume(",")) groups.push(this.parseGroup());
    this.skipWhitespace();
    if (this.peek() !== end) this.fail(`Expected ',' or '${end}'`);
    return groups;
  }

  private parseGroup(): Group {
    const type = this.parseTypeExpression();
    this.expect("(");
    const keys: KeySelector[] = [];
    do {
      keys.push(this.parseKey());
      this.skipWhitespace();
    } while (this.peek() === ".");
    this.expect(")");
    return { type, keys };
  }

  private parseTypeExpression(): TypeExpression {
    const members = [this.parseAtomicType()];
    while (this.consume("|")) members.push(this.parseAtomicType());
    return members.length === 1 ? members[0]! : { kind: "union", members };
  }

  private parseAtomicType(): AtomicType {
    let arrayDepth = 0;
    while (this.consume("A.")) arrayDepth += 1;
    this.skipWhitespace();
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
    this.expect(".");
    const name = this.parseIdentifier();
    const optional = this.consume("?");
    let record: Group[] | undefined;
    if (this.consume("{")) {
      record = this.consume("}") ? [] : this.parseGroupList("}");
      this.expect("}");
    }
    return { name, optional, ...(record === undefined ? {} : { record }) };
  }

  private parseIdentifier(): string {
    this.skipWhitespace();
    const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.source.slice(this.position));
    if (!match) this.fail("Expected identifier");
    this.position += match[0].length;
    return match[0];
  }

  private consume(token: string): boolean {
    this.skipWhitespace();
    if (!this.source.startsWith(token, this.position)) return false;
    this.position += token.length;
    return true;
  }

  private expect(token: string): void {
    if (!this.consume(token)) this.fail(`Expected '${token}'`);
  }

  private peek(): string | undefined {
    this.skipWhitespace();
    return this.source[this.position];
  }

  private skipWhitespace(): void {
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
