import { expect, test } from "bun:test";

const decoder = new TextDecoder();

function cli(input: string, ...args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const process = Bun.spawnSync(["bun", "cli.ts", ...args], {
    cwd: import.meta.dir,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: process.exitCode, stdout: decoder.decode(process.stdout), stderr: decoder.decode(process.stderr) };
}

test("CLI converts piped JSON to RIN v2 and TypeScript type", () => {
  expect(cli('{"name":"Ada","items":[{"id":1},{"id":"two","active":true}]}').stdout)
    .toBe('.{A.O items{B active?,N|S id},S name}\n');

  const prettyRin = cli('{"name":"Ada","items":[{"id":1},{"id":"two","active":true}]}', "-p").stdout;
  expect(prettyRin).toContain(".{\n");
  expect(prettyRin).toContain("  A.O items{\n");
  expect(prettyRin).toContain("  S name\n");

  expect(cli('{"name":"Ada"}', "--to=type").stdout).toBe("type Root={name:string;};\n");
  expect(cli('{"name":"Ada"}', "--to=type", "-p").stdout).toBe("type Root = {\n  name: string;\n};\n");
});

test("CLI detects RIN v2 and interfaces/types, and supports target shortcuts", () => {
  expect(cli(".{S name}", "-J").stdout).toBe('{"kind":"root","container":"object","groups":[{"type":{"kind":"atomic","base":"S","arrayDepth":0,"nullable":false},"keys":[{"name":"name","optional":false}]}]}\n');
  expect(cli(".{S name}", "-J", "-p").stdout).toContain('{\n  "kind": "root",');
  expect(cli("interface User { name: string; age?: number; }", "-R").stdout).toBe(".{S name,N age?}\n");
  expect(cli("type User = { name: string; age?: number; };", "-R").stdout).toBe(".{S name,N age?}\n");
  expect(cli("interface User { name: string; age?: number; }", "-R", "-p").stdout).toBe(".{\n  S name,\n  N age?\n}\n");
  expect(cli("interface User { name: string; }", "-T").stdout).toBe("type User={name:string;};\n");
  expect(cli("interface User { name: string; }", "-T", "-p").stdout).toBe("type User = {\n  name: string;\n};\n");
});

test("CLI coalesces keys of the same type at all nested levels", () => {
  const json = JSON.stringify({ reactions: { dislikes: 5, likes: 10 } });
  expect(cli(json).stdout).toBe(".{O reactions{N dislikes likes}}\n");
  expect(cli(json, "-p").stdout).toBe(".{\n  O reactions{\n    N dislikes likes\n  }\n}\n");

  const ts = "type Post = { reactions: { dislikes: number; likes: number; }; };";
  expect(cli(ts, "-R").stdout).toBe(".{O reactions{N dislikes likes}}\n");
  expect(cli(ts, "-R", "-p").stdout).toBe(".{\n  O reactions{\n    N dislikes likes\n  }\n}\n");
});

test("CLI accepts a positional source and overwrites an explicit output file", async () => {
  const path = `/tmp/rin-cli-${crypto.randomUUID()}.out`;
  expect(cli("", ".{S name}", "-o", path, "-T", "-p").exitCode).toBe(0);
  expect(await Bun.file(path).text()).toBe("type Root = {\n  name: string;\n};\n");
  expect(cli("", ".{N age}", `--output=${path}`, "-T", "-p").exitCode).toBe(0);
  expect(await Bun.file(path).text()).toBe("type Root = {\n  age: number;\n};\n");
});

test("CLI supports -h, --help-all, and -L/--legend help flags", () => {
  const shortHelp = cli("", "-h");
  expect(shortHelp.exitCode).toBe(0);
  expect(shortHelp.stdout).toContain("RIN CLI");
  expect(shortHelp.stdout).toContain("Usage:");

  const verboseHelp = cli("", "--help-all");
  expect(verboseHelp.exitCode).toBe(0);
  expect(verboseHelp.stdout).toContain("RIN CLI — Reduced Interface Notation tool (Verbose Help)");
  expect(verboseHelp.stdout).toContain("Description:");

  const legendHelp = cli("", "-L");
  expect(legendHelp.exitCode).toBe(0);
  expect(legendHelp.stdout).toContain("RIN Schema Notation Legend & Syntax Reference");
  expect(legendHelp.stdout).toContain("Base Types:");
  expect(legendHelp.stdout).toContain("Type Modifiers:");

  const legendsHelp = cli("", "--legends");
  expect(legendsHelp.exitCode).toBe(0);
  expect(legendsHelp.stdout).toContain("RIN Schema Notation Legend & Syntax Reference");
});

test("CLI reports invalid flags and unsupported JSON roots on stderr", () => {
  const badFlag = cli("{}", "--wat");
  expect(badFlag.exitCode).toBe(1);
  expect(badFlag.stdout).toBe("");
  expect(badFlag.stderr).toContain("unknown flag '--wat'");
  const scalar = cli("[1,2]");
  expect(scalar.exitCode).toBe(1);
  expect(scalar.stderr).toContain("arrays must contain object records");
});
