#!/usr/bin/env bun

import { detectAndConvert } from "./converter.ts";
import { render, type Target } from "./renderer.ts";

interface Options {
  output?: string;
  positional?: string;
  target: Target;
  pretty: boolean;
  name?: string;
  help?: "short" | "verbose" | "legend";
}

class CliError extends Error {}

/** Executes the RIN CLI. Exported to make embedding and tests straightforward. */
export async function run(argv: string[], stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number; output?: string }> {
  try {
    const options = parseArguments(argv);
    if (options.help === "short") {
      return { stdout: getShortHelp(), stderr: "", exitCode: 0 };
    }
    if (options.help === "verbose") {
      return { stdout: getVerboseHelp(), stderr: "", exitCode: 0 };
    }
    if (options.help === "legend") {
      return { stdout: getLegendHelp(), stderr: "", exitCode: 0 };
    }

    if (options.positional !== undefined && stdin.trim() !== "") {
      throw new CliError("provide input through stdin or a positional argument, not both");
    }
    const source = options.positional ?? stdin;
    if (source.trim() === "") throw new CliError("no input provided");
    const { schema, name, kind, value } = detectAndConvert(source);
    const output = options.target === "json" && kind === "json"
      ? `${JSON.stringify(value, null, options.pretty ? 2 : undefined)}\n`
      : render(schema, options.target, options.name ?? (kind === "rin" ? name : undefined), options.pretty);
    return { stdout: options.output ? "" : output, stderr: "", exitCode: 0, output: options.output ? output : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `rin: ${message}\n`, exitCode: 1 };
  }
}

function parseArguments(argv: string[]): Options {
  let output: string | undefined;
  let target: Target = "rin";
  let positional: string | undefined;
  let targetSet = false;
  let pretty = false;
  let name: string | undefined;
  let help: "short" | "verbose" | "legend" | undefined;

  const setTarget = (value: string): void => {
    if (value !== "json" && value !== "rin" && value !== "type" && value !== "go") throw new CliError(`invalid output format '${value}' (expected json, rin, type, or go)`);
    if (targetSet && target !== value) throw new CliError("conflicting output format flags");
    target = value as Target;
    targetSet = true;
  };
  const takeValue = (flag: string, index: number): [string, number] => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) throw new CliError(`missing value for ${flag}`);
    return [value, index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      const rest = argv.slice(index + 1);
      if (rest.length !== 1 || positional !== undefined) throw new CliError("expected at most one positional input");
      positional = rest[0]!;
      break;
    }
    if (arg === "-h" || arg === "--help") {
      help = "short";
    } else if (arg === "--help-all") {
      help = "verbose";
    } else if (arg === "-L" || arg === "--legend" || arg === "--legends") {
      help = "legend";
    } else if (arg === "-p" || arg === "--pretty") {
      pretty = true;
    } else if (arg === "-n" || arg === "--name") {
      const [value, next] = takeValue(arg, index);
      if (name !== undefined) throw new CliError("name was specified more than once");
      name = value;
      index = next;
    } else if (arg.startsWith("--name=")) {
      if (name !== undefined) throw new CliError("name was specified more than once");
      name = arg.slice(7);
    } else if (arg === "-o" || arg === "--output") {
      const [value, next] = takeValue(arg, index);
      if (output !== undefined) throw new CliError("output was specified more than once");
      output = value;
      index = next;
    } else if (arg.startsWith("--output=")) {
      if (output !== undefined || arg.slice(9) === "") throw new CliError("output was specified more than once or is empty");
      output = arg.slice(9);
    } else if (arg === "-t" || arg === "--to") {
      const [value, next] = takeValue(arg, index);
      setTarget(value);
      index = next;
    } else if (arg.startsWith("--to=")) {
      setTarget(arg.slice(5));
    } else if (arg === "-J" || arg === "--to-json") {
      setTarget("json");
    } else if (arg === "-R" || arg === "--to-rin") {
      setTarget("rin");
    } else if (arg === "-T" || arg === "--to-type") {
      setTarget("type");
    } else if (arg === "-G" || arg === "--to-go") {
      setTarget("go");
    } else if (arg.startsWith("-")) {
      throw new CliError(`unknown flag '${arg}'`);
    } else if (positional === undefined) {
      positional = arg;
    } else {
      throw new CliError("expected at most one positional input");
    }
  }
  return { output, positional, target, pretty, name, help };
}

function getShortHelp(): string {
  return `RIN CLI — Reduced Interface Notation tool

Usage:
  rin [options] [file]
  cat file.json | rin [options]

Example:
  $ rin -T '{String name; Number age}'
  type Root={name:string;};

Options:
  -h, --help      Show concise help summary
  --help-all      Show detailed usage and all options
  -L, --legend    Show schema notation legend and syntax guide
  -p, --pretty    Format output with multi-line pretty printing
  -J, --to-json   Convert input to representative JSON data
  -R, --to-rin    Convert input to RIN schema notation (default)
  -T, --to-type   Convert input to TypeScript type definition
  -G, --to-go     Convert input to Go struct definitions
  -n, --name NAME Name the generated RIN, TypeScript, or Go type
  -o, --output    Save output to specified file
`;
}

function getVerboseHelp(): string {
  return `RIN CLI — Reduced Interface Notation tool (Verbose Help)

Usage:
  rin [options] [input]
  rin [options] < input_file

Description:
  RIN (Reduced Interface Notation) is a compact schema format for structural data typing.
  This CLI converts between RIN schemas, JSON data, and TypeScript definitions.
  By default, outputs are token-minimized. Use -p/--pretty for multi-line formatting.

Input Formats (auto-detected):
  1. RIN Schema:      Record notation (e.g. '{String name; Number age}')
  2. JSON Data:        Valid JSON object or array of objects
  3. TS Interface:     TypeScript definition (e.g. 'type User = { name: string; }')

Target Output Flags (-t, --to <target>):
  -R, --to-rin       Output RIN schema notation (default)
  -J, --to-json      Output representative JSON data
  -T, --to-type      Output TypeScript type code
  -G, --to-go        Output Go struct definitions

Formatting Flags:
  -p, --pretty       Format output with multi-line pretty printing
  -n, --name NAME    Name the generated RIN, TypeScript, or Go type
  --name=NAME

File Output Flags:
  -o, --output FILE  Save output to FILE instead of stdout
  --output=FILE

Help Flags:
  -h, --help         Show concise help summary
  --help-all         Show detailed usage and all options
  -L, --legend       Show schema notation legend and syntax guide

Examples:
  1. Convert JSON data to minimal RIN schema:
     $ echo '{"name":"Ada","age":30}' | rin
     {Number age;String name}

  2. Convert JSON data to pretty multi-line RIN schema:
     $ echo '{"name":"Ada","age":30}' | rin -p
     {
       Number age
       String name
     }

  3. Convert RIN schema to minified TypeScript type:
     $ rin -T '{String name; Number age}'
     type Root={name:string;age:number;};

  4. Convert RIN schema to formatted multi-line TypeScript type:
     $ rin -T -p '{String name; Number age}'
     type Root = {
       name: string;
       age: number;
     };

  5. Convert JSON to TypeScript type file:
     $ rin -T -p -o user.ts user.json
`;
}

function getLegendHelp(): string {
  return `RIN Schema Notation Legend & Syntax Reference

Base Types:
  String  string      UTF-8 string value
  Number  number      Numeric value (excluding NaN)
  Boolean boolean     Boolean true or false
  Null    null        Null literal value
  Any     any         Unconstrained value

Type Modifiers:
  T[]     Array of T  (e.g., String[] -> string[])
  key?    Optional    Property may be omitted or null
  String|Number       Type union matching any member type

Grammar & Syntax Rules:
  {...}   Object root container
  [{...}] Array of object records root container
  String a b       Grouped primitive fields
  address{...}     Nested object field
  items[]{...}     Nested array of object records
`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let stdin = "";
  try {
    const options = parseArguments(argv);
    if (!options.help && options.positional === undefined && !process.stdin.isTTY) {
      stdin = await Bun.stdin.text();
    }
  } catch {
    // run() formats argument errors consistently
  }
  const result = await run(argv, stdin);
  if (result.output !== undefined) {
    try {
      await Bun.write(parseArguments(argv).output!, result.output);
    } catch (error) {
      process.stderr.write(`rin: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(result.stdout);
  }
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
