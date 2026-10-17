import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModInfoOptions } from "../dist/server/lua-config.js";

test("helper functions preserve true and false choices instead of falling back to the default", () => {
  const options = parseModInfoOptions(`
    local function option(description, data, hover)
      return { description = description or "", data = data, hover = hover or "" }
    end
    configuration_options = {
      { name = "maprevealer", label = "共享地图", options = { option("开启", true), option("关闭", false) }, default = true },
      { name = "modify_player_scale", label = "高亮玩家图标", options = { option("开启", true), option("关闭", false) }, default = true },
    }
  `);
  assert.equal(options.length, 2);
  for (const option of options) {
    assert.deepEqual(option.choices, [{ description: "开启", data: true }, { description: "关闭", data: false }]);
    assert.equal(option.defaultValue, true);
  }
});

test("functions generating shortcut options return independent lists for both dropdowns", () => {
  const options = parseModInfoOptions(`
    local function ExtraKeyOptions()
      local result = { { description = "Disabled", data = "DISABLED" } }
      for i = 1, 12 do result[#result + 1] = { description = "F" .. i, data = "F" .. i } end
      return result
    end
    configuration_options = {
      { name = "wheel", options = ExtraKeyOptions(), default = "F5" },
      { name = "panel", options = ExtraKeyOptions(), default = "F6" },
    }
  `);
  assert.deepEqual(options.map((option) => option.choices.length), [13, 13]);
  assert.deepEqual(options[0].choices.map((choice) => choice.data), ["DISABLED", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);
  assert.deepEqual(options.map((option) => option.defaultValue), ["F5", "F6"]);
});

test("closures, anonymous functions, nested calls and early returns respect local scopes", () => {
  const options = parseModInfoOptions(`
    local prefix = "Value "
    local function factory(prefix)
      return function(value)
        if value == false then return { description = prefix .. "off", data = false } end
        return { description = prefix .. value, data = value }
      end
    end
    local build = factory("Choice ")
    local function list()
      local prefix = "Local "
      local result = {}
      for i = 1, 3 do table.insert(result, build(i)) end
      table.insert(result, build(false))
      return result
    end
    configuration_options = { { name = "mode", label = prefix .. "mode", options = list(), default = 2 } }
  `);
  assert.equal(options[0].label, "Value mode");
  assert.deepEqual(options[0].choices, [1, 2, 3].map((data) => ({ description: `Choice ${data}`, data })).concat({ description: "Choice off", data: false }));
  assert.equal(options[0].defaultValue, 2);
});

test("fallback parsing does not truncate generated choices or replace evaluated defaults", () => {
  const [option] = parseModInfoOptions(`
    local function enabled() return true end
    local choices = { { description = "Off", data = false } }
    table.insert(choices, { description = "On", data = true })
    configuration_options = { { name = "active", label = "Feature " .. "enabled", options = choices, default = enabled() } }
  `);
  assert.equal(option.label, "Feature enabled");
  assert.equal(option.defaultValue, true);
  assert.equal(option.choices.length, 2);
});

test("static interpreter never executes OS, filesystem or dynamically loaded code", () => {
  const options = parseModInfoOptions(`
    local function safe()
      os.execute("should never execute")
      io.open("should never open")
      loadstring("should never evaluate")
      return { { description = "Safe", data = 1 }, { description = "Other", data = 2 } }
    end
    configuration_options = { { name = "safe", options = safe(), default = 1 } }
  `);
  assert.equal(options[0].choices.length, 2);
});

test("recursive helpers and excessive work remain bounded", () => {
  assert.throws(() => parseModInfoOptions(`local function recurse() return recurse() end configuration_options = recurse()`), /调用过深/);
  assert.throws(() => parseModInfoOptions(`
    local function many()
      local result = {}
      for i = 1, 2000 do
        for j = 1, 2000 do result[#result + 1] = { description = "item", data = i } end
      end
      return result
    end
    configuration_options = many()
  `), /步骤过多/);
});

test("literal fallback still works when unrelated syntax is unsupported", () => {
  const [option] = parseModInfoOptions(`configuration_options = { { name = "mode", options = { {description="A",data="a"}, {description="B",data="b"} }, default="b" } } goto unsupported`);
  assert.equal(option.choices.length, 2);
  assert.equal(option.defaultValue, "b");
});
