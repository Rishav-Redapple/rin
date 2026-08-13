import { describe, expect, test } from "bun:test";
import { parse, RinSyntaxError, validate } from "./rin.ts";

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
