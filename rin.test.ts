import { describe, expect, test } from "bun:test";
import { parse, RinSyntaxError, validate } from "./rin.ts";
import { renderRin } from "./renderer.ts";
import { inferRoot } from "./converter.ts";

const schema = `
  # Account schema
  {
    String name role
    Number id ref_id?
    Boolean active
    tags[]{String name; Number id}
    String[] ruleset
  }
`;

describe("parse (RIN v3)", () => {
  test("parses named primitives, arrays, object-key records, comments, and optional keys", () => {
    expect(parse(schema)).toEqual({
      kind: "root", container: "object", groups: [
        { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [{ name: "name", optional: false }, { name: "role", optional: false }] },
        { type: { kind: "atomic", base: "N", arrayDepth: 0, nullable: false }, keys: [{ name: "id", optional: false }, { name: "ref_id", optional: true }] },
        { type: { kind: "atomic", base: "B", arrayDepth: 0, nullable: false }, keys: [{ name: "active", optional: false }] },
        { type: { kind: "atomic", base: "O", arrayDepth: 1, nullable: false }, keys: [{ name: "tags", optional: false, record: [
          { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [{ name: "name", optional: false }] },
          { type: { kind: "atomic", base: "N", arrayDepth: 0, nullable: false }, keys: [{ name: "id", optional: false }] },
        ] }] },
        { type: { kind: "atomic", base: "S", arrayDepth: 1, nullable: false }, keys: [{ name: "ruleset", optional: false }] },
      ],
    });
  });

  test("detects schemas that start with a comment", async () => {
    const { detectAndConvert } = await import("./converter.ts");
    expect(detectAndConvert("# comment\n{String name}").kind).toBe("rin");
  });

  test("keeps primitive/key interpretation unambiguous", () => {
    expect(parse("{String String}").groups[0]?.keys[0]?.name).toBe("String");
    expect(() => parse("{String{Number id}}")).toThrow(RinSyntaxError);
  });

  test("accepts unions and array record roots", () => {
    expect(parse("[{String|Number id}]").container).toBe("array");
    expect(parse("{String name Number id}").groups[0]?.keys.map((key) => key.name)).toEqual(["name", "Number", "id"]);
  });

  test("accepts quoted keys and multiline primitive blocks", () => {
    const parsed = parse(`{String (\n  "1" Null string other\n)}`);
    expect(parsed.groups[0]?.keys.map((key) => key.name)).toEqual(["1", "Null", "string", "other"]);
  });

  test("renders long primitive groups as multiline blocks only in pretty mode", () => {
    const parsed = parse('{String "1" "Null" "string" a b c d e f}');
    expect(renderRin(parsed, false)).toBe('{String "1" "Null" "string" a b c d e f}\n');
    expect(renderRin(parsed, true)).toBe(`{
  String (
    "1" "Null" "string" a b
    c d e f
  )
}\n`);
  });

  test("parses object key unions", () => {
    const parsed = parse("{a|b|c[]{Number item_id quantity;String type}}");
    expect(parsed.groups[0]?.keys.map((key) => key.name)).toEqual(["a", "b", "c"]);
    expect(renderRin(parsed, false)).toBe("{a|b|c[]{Number item_id quantity;String type}}\n");
  });

  test("coalesces objects with the same structure into object key unions", () => {
    const parsed = inferRoot({
      a: [{ item_id: 1, quantity: 2, type: "x" }],
      b: [{ item_id: 3, quantity: 4, type: "y" }],
      c: [{ item_id: 5, quantity: 6, type: "z" }],
    });
    expect(renderRin(parsed, true)).toContain("a|b|c[]{");
  });
});

describe("validate (RIN v3)", () => {
  test("validates nested values, optional/null fields, and extra properties", () => {
    expect(validate(schema, {
      name: "Ada", role: "admin", id: 1, ref_id: null, active: true,
      tags: [{ name: "staff", id: 2 }], ruleset: ["read"], extra: "allowed",
    }).ok).toBe(true);
  });

  test("reports invalid paths", () => {
    const result = validate(schema, { name: 1, role: "admin", id: 1, active: true, tags: [{ name: "bad", id: "no" }], ruleset: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.path)).toEqual(["$.name", "$.tags[0].id"]);
  });
});
