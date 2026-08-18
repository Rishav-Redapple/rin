# RIN — Reduced Interface Notation

RIN is a readable, compact schema notation with a TypeScript parser, runtime validator, and CLI.

```txt
{
  String name role
  Number id ref_id?
  Boolean active
  tags[]{String name; Number id}
  String[] ruleset
}
```

- Primitives are `String`, `Number`, `Boolean`, `Null`, and `Any`.
- `[]` adds an array dimension; `tags[]{...}` is an array of object records.
- `?` belongs to a key and permits that field to be omitted or `null`.
- A nested object is written as its field name followed by a record: `address{String city}`.
- `|` creates a union, such as `String|Number id`.
- Keys that could be confused with primitives or numbers are quoted, such as `String "1" "Null" "string"`.
- In pretty output, primitive groups with more than five keys use a multiline block: `String (name last_name maiden_name? surname hash\n  here there where)`.
- `#` starts a comment. Newlines, commas, and semicolons separate groups.
- The first token of a group is always its primitive or object key. This makes `String String` unambiguous: it declares a string field named `String`.

## CLI

The CLI auto-detects JSON data, RIN, and simple TypeScript `type`/`interface` declarations. Compact output is the default; use `-p` for multiline JSON, RIN, or TypeScript.

```bash
# JSON to compact RIN
curl -s https://example.test/data.json | bun cli.ts

# RIN to formatted TypeScript with an explicit root type name
printf '{String name; Number id}' | bun cli.ts -T -p --name=User > user.ts

# Name the RIN root itself
printf '{String name; Number id}' | bun cli.ts -R --name=User
# User {String name;Number id}

# RIN to JSON data (not the internal AST)
printf '{String name; Number id}' | bun cli.ts -J

# RIN to formatted Go structs
printf '{String name; Number id?}' | bun cli.ts -G -p --name=User > user.go
```

Supported targets are `json`, `rin`, `type`, and `go` (`-t go` / `--to=go`), with shortcuts `-J`, `-R`, `-T`, and `-G` / `--to-go`. Other flags: `-p` / `--pretty`, `-n NAME` / `--name=NAME`, and `-o` / `--output`.

## Development

```bash
bun install
bun test
bun run typecheck
```
