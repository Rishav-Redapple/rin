import { describe, expect, test } from "bun:test";
import { parse, RinSyntaxError, validate } from "./rin.ts";

describe("parse (RIN v2)", () => {
  test("parses space-separated inline groups, block groups, unions, optional fields, and arrays", () => {
    const schema = parse(`
      .{
        S name,
        N|S id,
        A.O users?{ S email, B active? },
        O(
          hair{S color type}
          address{
            S address city state,
            O coords{N lat lng},
            L ipProvider
          }
        )
      }
    `);
    expect(schema).toEqual({
      kind: "root", container: "object", groups: [
        { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [{ name: "name", optional: false }] },
        { type: { kind: "union", members: [
          { kind: "atomic", base: "N", arrayDepth: 0, nullable: false },
          { kind: "atomic", base: "S", arrayDepth: 0, nullable: false },
        ] }, keys: [{ name: "id", optional: false }] },
        { type: { kind: "atomic", base: "O", arrayDepth: 1, nullable: false }, keys: [{ name: "users", optional: true, record: [
          { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [{ name: "email", optional: false }] },
          { type: { kind: "atomic", base: "B", arrayDepth: 0, nullable: false }, keys: [{ name: "active", optional: true }] },
        ] }] },
        { type: { kind: "atomic", base: "O", arrayDepth: 0, nullable: false }, keys: [
          { name: "hair", optional: false, record: [
            { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [
              { name: "color", optional: false },
              { name: "type", optional: false },
            ] },
          ] },
          { name: "address", optional: false, record: [
            { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [
              { name: "address", optional: false },
              { name: "city", optional: false },
              { name: "state", optional: false },
            ] },
            { type: { kind: "atomic", base: "O", arrayDepth: 0, nullable: false }, keys: [
              { name: "coords", optional: false, record: [
                { type: { kind: "atomic", base: "N", arrayDepth: 0, nullable: false }, keys: [
                  { name: "lat", optional: false },
                  { name: "lng", optional: false },
                ] },
              ] },
            ] },
            { type: { kind: "atomic", base: "L", arrayDepth: 0, nullable: false }, keys: [
              { name: "ipProvider", optional: false },
            ] },
          ] },
        ] },
      ],
    });
  });

  test("parses escaped identifier tokens ($S, $N, etc.)", () => {
    const parsed = parse(".{ N $S $N, S $B }");
    expect(parsed.groups).toEqual([
      { type: { kind: "atomic", base: "N", arrayDepth: 0, nullable: false }, keys: [
        { name: "S", optional: false },
        { name: "N", optional: false },
      ] },
      { type: { kind: "atomic", base: "S", arrayDepth: 0, nullable: false }, keys: [
        { name: "B", optional: false },
      ] },
    ]);
  });

  test("rejects malformed syntax with a location", () => {
    expect(() => parse(".{S name")).toThrow(RinSyntaxError);
    expect(() => parse(".{Q name}")).toThrow("Expected base type");
  });
});

describe("validate (RIN v2)", () => {
  const schema = ".{ S name, N? age, O profile{ B enabled }, A.O users?{ S email } }";

  test("accepts optional fields, nullable values, nested arrays, and extra fields", () => {
    expect(validate(schema, {
      name: "Ada", age: null, profile: { enabled: true, ignored: 1 },
      users: [{ email: "a@example.test" }], extra: "allowed",
    })).toEqual({ ok: true, value: {
      name: "Ada", age: null, profile: { enabled: true, ignored: 1 },
      users: [{ email: "a@example.test" }], extra: "allowed",
    } });
  });

  test("collects nested validation errors", () => {
    const result = validate(schema, { name: 1, profile: { enabled: "yes" }, users: [{ email: 2 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.path)).toEqual(["$.name", "$.age", "$.profile.enabled", "$.users[0].email"]);
  });

  test("supports unions and root arrays", () => {
    expect(validate(".[ N|S id, B enabled ]", [{ id: 1, enabled: true }, { id: "two", enabled: false }]).ok).toBe(true);
    expect(validate(".[ N id ]", [{ id: false }]).ok).toBe(false);
  });

  test("supports null, unknown, plain objects, and recursive arrays", () => {
    const schema = ".{ L empty, X anything, O meta, A.A.N matrix }";
    expect(validate(schema, {
      empty: null, anything: Symbol("value"), meta: Object.create(null), matrix: [[1, 2], [3]],
    }).ok).toBe(true);
    expect(validate(schema, { empty: undefined, anything: 1, meta: [], matrix: [[1, "no"]] }).ok).toBe(false);
  });

  test("reports missing required fields and invalid root containers", () => {
    const missing = validate(".{ S name }", {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toBe("$.name");
    expect(validate(".{}", []).ok).toBe(false);
  });
});

