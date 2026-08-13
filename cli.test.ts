import { expect, test } from "bun:test";

const decoder = new TextDecoder();

function cli(input: string, ...args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const process = Bun.spawnSync(["bun", "cli.ts", ...args], {
    cwd: import.meta.dir, stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe",
  });
  return { exitCode: process.exitCode, stdout: decoder.decode(process.stdout), stderr: decoder.decode(process.stderr) };
}

test("CLI converts piped JSON to compact and pretty RIN v3", () => {
  const json = '{"name":"Ada","items":[{"id":1},{"id":"two","active":true}]}' ;
  expect(cli(json).stdout).toBe("{items[]{Boolean active?;Number|String id};String name}\n");
  const pretty = cli(json, "-p").stdout;
  expect(pretty).toContain("{\n");
  expect(pretty).toContain("items[]{");
});

test("CLI emits JSON data rather than the schema AST", () => {
  expect(cli("{String name; Number id}", "-J").stdout).toBe('{"name":"","id":0}\n');
  expect(cli("{String name; Number id}", "-J", "-p").stdout).toBe('{\n  "name": "",\n  "id": 0\n}\n');
  expect(cli('{"name":"Ada","id":7}', "-J").stdout).toBe('{"name":"Ada","id":7}\n');
});

test("CLI supports RIN/type detection, pretty output, and root overrides", () => {
  expect(cli("interface User { name: string; age?: number; }", "-R").stdout).toBe("{String name;Number age?}\n");
  expect(cli("{String name}", "-T", "--name=Account").stdout).toBe("type Account={name:string;};\n");
  expect(cli("{String name}", "-T", "-n", "Account", "-p").stdout).toBe("type Account = {\n  name: string;\n};\n");
  expect(cli("{String name}", "-R", "-n", "User Profile").stdout).toBe("User Profile {String name}\n");
  expect(cli("{Number id?}", "-T").stdout).toBe("type Root={id?:number|null;};\n");
  expect(cli("{String name}", "-R", "-n", "Account").stdout).toBe("Account {String name}\n");
  expect(cli("Account {String name}", "-T").stdout).toBe("type Account={name:string;};\n");
  expect(cli("{String name;Number id?}", "-G", "--name=User").stdout).toBe("type User struct{Name string `json:\"name\"`;Id *float64 `json:\"id,omitempty\"`}\n");
  expect(cli("{String name;Number id?}", "--to-go", "--name=User", "-p").stdout).toBe("type User struct {\n  Name string `json:\"name\"`\n  Id *float64 `json:\"id,omitempty\"`\n}\n");
  expect(cli("{Boolean active}", "--to=go").stdout).toBe("type Root struct{Active bool `json:\"active\"`}\n");
});

test("CLI accepts an output file and rejects invalid roots", async () => {
  const path = `/tmp/rin-cli-${crypto.randomUUID()}.out`;
  expect(cli("", "{String name}", "-o", path, "-T").exitCode).toBe(0);
  expect(await Bun.file(path).text()).toBe("type Root={name:string;};\n");
  const invalid = cli("{String{Number id}}");
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("Expected identifier");
});
