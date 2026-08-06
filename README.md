# RIN — Reduced Interface Notation

RIN is a compact schema notation with a TypeScript parser, runtime validator, and CLI tool designed for optimal token efficiency when prompting Large Language Models (LLMs) or defining structural schemas.

### Token Efficiency Comparison

![RIN Token Efficiency Comparison](hero.png)

RIN reduces character count by **~45%** and token usage by **~40%** compared to standard verbose JSON structures, keeping schemas lightweight and precise.

## Quick Start

```ts
import { validate } from "./rin.ts";

const result = validate(
  ".{ S name, N? age, A.O users?{ S email } }",
  { name: "Ada", age: null, users: [{ email: "ada@example.test" }] }
);

if (result.ok) {
  console.log("Valid payload:", result.value);
} else {
  console.error("Validation errors:", result.errors);
}
```

## Notation Reference

- **Root Containers**: `.{...}` (object root) or `.[...]` (array of records root).
- **Base Types**:
  - `S` — String
  - `N` — Number
  - `B` — Boolean
  - `L` — Null
  - `X` — Unknown / Any
  - `O` — Plain Object / Nested Record
- **Array Layer Modifier**: `A.` prefix adds an array dimension (e.g. `A.S` is `string[]`, `A.A.N` is `number[][]`).
- **Nullable Suffix**: `?` after a base type makes it nullable (e.g., `S?`, `A.N?`).
- **Optional Property**: `?` after a key identifier makes the property optional (e.g., `age?`).
- **Unions**: `|` creates a type union (e.g., `N|S id`).
- **Grouped Keys**: Keys sharing a type are grouped together separated by space (e.g., `S firstName lastName email`, `N id age`).
- **Block Groups**: `TypeExpr(...)` allows grouping fields across multiple lines (e.g. `O( hair{S color} address{S city} )`).
- **Escaped Identifiers**: Fields matching base type letters are escaped with `$` (e.g., `$S`, `$N`).

*Note: Whitespace between tokens is ignored. Undeclared extra object properties are allowed by default during validation.*

## API Reference

### `parse(source: string): RootSchema`
Parses a RIN syntax string into a `RootSchema` AST structure. Throws a `RinSyntaxError` with error position details if syntax is invalid.

### `validate<T>(schema: RootSchema | string, value: T): ValidationResult<T>`
Validates a runtime JavaScript value against a RIN schema string or parsed AST.
Returns either `{ ok: true, value }` or `{ ok: false, errors: ValidationIssue[] }`.

## CLI Usage

The `rin` CLI automatically detects input format (JSON, RIN schema, or TypeScript `type`/`interface`) from `stdin` or a positional string argument.

```bash
# Print syntax legend & notation reference guide
bun cli.ts -L

# Convert JSON or interface from pipe to TypeScript types
curl -s https://example.test/data.json | bun cli.ts --to=type -p > types.ts

# Convert JSON to token-minimized RIN schema
bun cli.ts < response.json > schema.rin

# Convert RIN to JSON AST representation
printf '.{S name}' | bun cli.ts --to-json

# Save formatted RIN schema directly to file
bun cli.ts payload.json -p -o schema.rin
```

### CLI Flags
- `-t <format>` / `--to=<format>`: Specify target output format (`json`, `rin`, or `type`). Default is `rin`.
- `-J` / `--to-json`: Shortcut for `--to=json`.
- `-R` / `--to-rin`: Shortcut for `--to=rin`.
- `-T` / `--to-type`: Shortcut for `--to=type`.
- `-p` / `--pretty`: Output multi-line formatted representations across all targets.
- `-L` / `--legend`: Print syntax legend and notation reference guide.
- `-o <file>` / `--output=<file>`: Save output directly to file.
- `-h` / `--help`: Show concise help summary.
- `--help-all`: Show verbose usage guide and options.

## Development

```bash
# Install dependencies
bun install

# Run unit and integration tests
bun test
```
