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

test("CLI converts piped JSON to RIN and TypeScript", () => {
  expect(cli('{"name":"Ada","items":[{"id":1},{"id":"two","active":true}]}').stdout)
    .toBe('.{A.O(.items{B(.active?),N|S(.id)}),S(.name)}\n');
  expect(cli('{"name":"Ada"}', "--to=type").stdout).toBe("interface Root {\n  name: string;\n}\n");
});

test("CLI detects RIN and interfaces, and supports target shortcuts", () => {
  expect(cli(".{S(.name)}", "-J").stdout).toContain('"container": "object"');
  expect(cli("interface User { name: string; age?: number; }", "-R").stdout).toBe(".{S(.name),N(.age?)}\n");
  expect(cli("interface User { name: string; }", "-T").stdout).toBe("interface User {\n  name: string;\n}\n");
});

test("CLI accepts a positional source and overwrites an explicit output file", async () => {
  const path = `/tmp/rin-cli-${crypto.randomUUID()}.out`;
  expect(cli("", ".{S(.name)}", "-o", path, "-T").exitCode).toBe(0);
  expect(await Bun.file(path).text()).toBe("interface Root {\n  name: string;\n}\n");
  expect(cli("", ".{N(.age)}", `--output=${path}`, "-T").exitCode).toBe(0);
  expect(await Bun.file(path).text()).toBe("interface Root {\n  age: number;\n}\n");
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
