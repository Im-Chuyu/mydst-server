import * as luaparse from "luaparse";

export type ModConfigValue = string | number | boolean;
export interface ModConfigChoice { description: string; data: ModConfigValue }
export interface ModConfigOption {
  name: string;
  label: string;
  hover: string;
  defaultValue: ModConfigValue;
  choices: ModConfigChoice[];
}

export interface ParsedModOverride {
  id: string;
  enabled: boolean;
  configuration: string;
}

export interface ModInfoMetadata {
  name: string;
}

type LuaKey = string | number;
type LuaValue = ModConfigValue | LuaTable | null | undefined;

class LuaTable {
  readonly entries = new Map<LuaKey, LuaValue>();

  set(key: LuaKey, value: LuaValue): void { this.entries.set(key, value); }
  get(key: LuaKey): LuaValue { return this.entries.get(key); }
  length(): number {
    let index = 1;
    while (this.entries.has(index)) index += 1;
    return index - 1;
  }
  append(value: LuaValue): void { this.set(this.length() + 1, value); }
}

export function parseModInfoOptions(source: string): ModConfigOption[] {
  const chunk = parseLua(source);
  const interpreter = new StaticLuaInterpreter();
  interpreter.run(chunk.body);
  const configuration = interpreter.env.get("configuration_options");
  if (!(configuration instanceof LuaTable)) return [];
  return tableValues(configuration).flatMap((entry) => {
    if (!(entry instanceof LuaTable)) return [];
    const name = primitiveString(entry.get("name"));
    const defaultValue = primitive(entry.get("default"));
    if (!name || defaultValue === undefined) return [];
    const choicesValue = entry.get("options");
    const choices = choicesValue instanceof LuaTable ? tableValues(choicesValue).flatMap((choice) => {
      if (!(choice instanceof LuaTable)) return [];
      const data = primitive(choice.get("data"));
      if (data === undefined) return [];
      return [{ description: primitiveString(choice.get("description")) || String(data), data }];
    }) : [];
    return [{
      name,
      label: primitiveString(entry.get("label")) || name,
      hover: primitiveString(entry.get("hover")) || "",
      defaultValue,
      choices: choices.length ? choices : [{ description: String(defaultValue), data: defaultValue }]
    }];
  });
}

export function parseModInfoMetadata(source: string): ModInfoMetadata {
  const chunk = parseLua(source);
  const interpreter = new StaticLuaInterpreter();
  interpreter.run(chunk.body);
  return { name: primitiveString(interpreter.env.get("name")).trim() };
}

export function parseConfigurationValues(source: string): Record<string, ModConfigValue> {
  const value = parseConfigurationTable(source);
  if (!(value instanceof LuaTable)) throw new Error("MOD Lua 配置必须是一个表");
  const result: Record<string, ModConfigValue> = {};
  for (const [key, entry] of value.entries) {
    const parsed = primitive(entry);
    if (typeof key !== "string" || parsed === undefined) throw new Error("MOD Lua 配置仅支持字符串键和字符串、数字、布尔值");
    result[key] = parsed;
  }
  return result;
}

export function normalizeConfigurationTable(source: string): string {
  return serializeLuaValue(parseConfigurationTable(source));
}

export function parseModOverrides(source: string): ParsedModOverride[] {
  const chunk = parseLua(source);
  const statement = chunk.body.find((item: unknown) => (item as { type?: string }).type === "ReturnStatement") as unknown as { arguments?: unknown[] } | undefined;
  if (!statement || statement.arguments?.length !== 1) throw new Error("modoverrides.lua 必须返回一个表");
  const interpreter = new StaticLuaInterpreter();
  const value = interpreter.evaluate(statement.arguments[0]);
  if (!(value instanceof LuaTable)) throw new Error("modoverrides.lua 必须返回一个表");
  const mods: ParsedModOverride[] = [];
  for (const [key, entry] of value.entries) {
    const id = typeof key === "string" ? key.match(/^workshop-(\d{5,12})$/)?.[1] : undefined;
    if (!id || !(entry instanceof LuaTable)) continue;
    const configuration = entry.get("configuration_options");
    mods.push({
      id,
      enabled: entry.get("enabled") !== false,
      configuration: configuration instanceof LuaTable ? serializeLuaValue(configuration) : "{}"
    });
  }
  return mods;
}

function parseConfigurationTable(source: string): LuaTable {
  const chunk = parseLua(`return ${source}`);
  const statement = chunk.body[0] as unknown as { type?: string; arguments?: unknown[] } | undefined;
  if (!statement || statement.type !== "ReturnStatement" || statement.arguments?.length !== 1) throw new Error("MOD Lua 配置必须是一个表");
  const interpreter = new StaticLuaInterpreter();
  const value = interpreter.evaluate(statement.arguments[0]);
  if (!(value instanceof LuaTable)) throw new Error("MOD Lua 配置必须是一个表");
  return value;
}

function serializeLuaValue(value: LuaValue, depth = 0): string {
  if (depth > 20) throw new Error("MOD Lua 配置嵌套过深");
  if (value === null) return "nil";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
  if (!(value instanceof LuaTable)) throw new Error("MOD Lua 配置只能包含静态表、字符串、数字和布尔值");
  const fields: string[] = [];
  for (const [key, entry] of value.entries) {
    const serialized = serializeLuaValue(entry, depth + 1);
    if (typeof key === "number") fields.push(`[${key}] = ${serialized}`);
    else fields.push(`[${serializeLuaValue(key, depth + 1)}] = ${serialized}`);
  }
  return fields.length ? `{ ${fields.join(", ")} }` : "{}";
}

class StaticLuaInterpreter {
  readonly env = new Map<string, LuaValue>();
  private steps = 0;

  run(statements: unknown[]): void {
    for (const statement of statements) this.execute(statement);
  }

  evaluate(input: unknown): LuaValue {
    this.tick();
    const node = input as Record<string, any> | undefined;
    if (!node) return undefined;
    switch (node.type) {
      case "StringLiteral": return typeof node.value === "string" ? Buffer.from(node.value, "latin1").toString("utf8") : undefined;
      case "NumericLiteral": return Number(node.value);
      case "BooleanLiteral": return Boolean(node.value);
      case "NilLiteral": return null;
      case "Identifier": return this.env.get(node.name);
      case "TableConstructorExpression": {
        const table = new LuaTable();
        for (const field of node.fields || []) {
          if (field.type === "TableValue") table.append(this.evaluate(field.value));
          else if (field.type === "TableKeyString") table.set(field.key.name, this.evaluate(field.value));
          else if (field.type === "TableKey") {
            const key = this.evaluate(field.key);
            if (typeof key === "string" || typeof key === "number") table.set(key, this.evaluate(field.value));
          }
        }
        return table;
      }
      case "IndexExpression": {
        const base = this.evaluate(node.base);
        const key = this.evaluate(node.index);
        return base instanceof LuaTable && (typeof key === "string" || typeof key === "number") ? base.get(key) : undefined;
      }
      case "MemberExpression": {
        const base = this.evaluate(node.base);
        return base instanceof LuaTable ? base.get(node.identifier.name) : undefined;
      }
      case "UnaryExpression": return this.unary(node.operator, this.evaluate(node.argument));
      case "BinaryExpression":
      case "LogicalExpression": return this.binary(node.operator, this.evaluate(node.left), this.evaluate(node.right));
      case "CallExpression": return this.call(node);
      default: return undefined;
    }
  }

  private execute(input: unknown): void {
    this.tick();
    const node = input as Record<string, any> | undefined;
    if (!node) return;
    switch (node.type) {
      case "LocalStatement":
      case "AssignmentStatement":
        (node.variables || []).forEach((target: unknown, index: number) => this.assign(target, this.evaluate(node.init?.[index])));
        break;
      case "CallStatement": this.evaluate(node.expression); break;
      case "ForNumericStatement": {
        const start = numeric(this.evaluate(node.start));
        const end = numeric(this.evaluate(node.end));
        const step = node.step ? numeric(this.evaluate(node.step)) : 1;
        if (start === undefined || end === undefined || !step) break;
        const iterations = Math.min(2_000, Math.max(0, Math.floor((end - start) / step) + 1));
        for (let offset = 0; offset < iterations; offset += 1) {
          this.env.set(node.variable.name, start + offset * step);
          this.run(node.body || []);
        }
        break;
      }
      case "ForGenericStatement": {
        const call = node.iterators?.[0];
        const table = call?.type === "CallExpression" ? this.evaluate(call.arguments?.[0]) : undefined;
        if (!(table instanceof LuaTable)) break;
        for (const [key, value] of table.entries) {
          if (node.variables?.[0]) this.env.set(node.variables[0].name, key);
          if (node.variables?.[1]) this.env.set(node.variables[1].name, value);
          this.run(node.body || []);
        }
        break;
      }
      case "IfStatement": {
        for (const clause of node.clauses || []) {
          if (clause.type === "ElseClause" || truthy(this.evaluate(clause.condition))) {
            this.run(clause.body || []);
            break;
          }
        }
        break;
      }
    }
  }

  private assign(input: unknown, value: LuaValue): void {
    const target = input as Record<string, any> | undefined;
    if (!target) return;
    if (target.type === "Identifier") { this.env.set(target.name, value); return; }
    if (target.type === "IndexExpression" || target.type === "MemberExpression") {
      const base = this.evaluate(target.base);
      const key = target.type === "MemberExpression" ? target.identifier.name : this.evaluate(target.index);
      if (base instanceof LuaTable && (typeof key === "string" || typeof key === "number")) base.set(key, value);
    }
  }

  private call(node: Record<string, any>): LuaValue {
    const args = (node.arguments || []).map((argument: unknown) => this.evaluate(argument));
    if (node.base?.type === "Identifier") {
      if (node.base.name === "tostring") return args[0] === undefined || args[0] === null ? "nil" : String(args[0]);
      if (node.base.name === "tonumber") return numeric(args[0]);
    }
    if (node.base?.type !== "MemberExpression" || node.base.base?.type !== "Identifier") return undefined;
    const library = node.base.base.name;
    const method = node.base.identifier.name;
    if (library === "string" && method === "char") {
      const code = numeric(args[0]);
      return code === undefined ? undefined : String.fromCharCode(code);
    }
    if (library === "table" && method === "insert" && args[0] instanceof LuaTable) {
      if (args.length === 2) args[0].append(args[1]);
      else {
        const index = numeric(args[1]);
        if (index !== undefined) args[0].set(index, args[2]);
      }
      return null;
    }
    return undefined;
  }

  private unary(operator: string, value: LuaValue): LuaValue {
    if (operator === "-") { const number = numeric(value); return number === undefined ? undefined : -number; }
    if (operator === "not") return !truthy(value);
    if (operator === "#") return value instanceof LuaTable ? value.length() : typeof value === "string" ? value.length : undefined;
    return undefined;
  }

  private binary(operator: string, left: LuaValue, right: LuaValue): LuaValue {
    if (operator === "..") return `${left ?? ""}${right ?? ""}`;
    if (operator === "and") return truthy(left) ? right : left;
    if (operator === "or") return truthy(left) ? left : right;
    if (operator === "==") return left === right;
    if (operator === "~=") return left !== right;
    const a = numeric(left);
    const b = numeric(right);
    if (a === undefined || b === undefined) return undefined;
    return ({ "+": a + b, "-": a - b, "*": a * b, "/": a / b, "%": a % b, "^": a ** b, "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b } as Record<string, LuaValue>)[operator];
  }

  private tick(): void {
    this.steps += 1;
    if (this.steps > 100_000) throw new Error("modinfo.lua 静态解析步骤过多");
  }
}

function tableValues(table: LuaTable): LuaValue[] {
  return Array.from({ length: table.length() }, (_, index) => table.get(index + 1));
}
function primitive(value: LuaValue): ModConfigValue | undefined { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined; }
function primitiveString(value: LuaValue): string { const parsed = primitive(value); return parsed === undefined ? "" : String(parsed); }
function numeric(value: LuaValue): number | undefined { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; }
function truthy(value: LuaValue): boolean { return value !== false && value !== null && value !== undefined; }
function parseLua(source: string) { return luaparse.parse(Buffer.from(source, "utf8").toString("latin1"), { luaVersion: "5.1", encodingMode: "pseudo-latin1" }); }
