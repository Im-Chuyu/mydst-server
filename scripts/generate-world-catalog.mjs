import fs from "node:fs";
import path from "node:path";

const gameRoot = process.env.DST_GAME_ROOT || "D:/steam/steamapps/common/Don't Starve Together";
const scriptRoot = path.join(gameRoot, "mods", "yuanma", "scripts");
const customizeFile = path.join(scriptRoot, "map", "customize.lua");
const poFile = path.join(scriptRoot, "languages", "chinese_s.po");
const iconFile = path.resolve("src/server/world-icon-manifest.json");
const outputFile = path.resolve("src/server/world-catalog-data.json");

for (const file of [customizeFile, poFile, iconFile]) {
  if (!fs.existsSync(file)) throw new Error(`Missing source file: ${file}`);
}

const source = fs.readFileSync(customizeFile, "utf8");
const translations = parsePo(fs.readFileSync(poFile, "utf8"));
const icons = JSON.parse(fs.readFileSync(iconFile, "utf8"));

const choiceSets = {
  frequency_descriptions: choices([["never","无"],["rare","很少"],["default","默认"],["often","较多"],["always","大量"]]),
  worldgen_frequency_descriptions: choices([["never","无"],["rare","很少"],["uncommon","较少"],["default","默认"],["often","较多"],["mostly","很多"],["always","大量"],["insane","疯狂"]]),
  ocean_worldgen_frequency_descriptions: choices([["ocean_never","无"],["ocean_rare","很少"],["ocean_uncommon","较少"],["ocean_default","默认"],["ocean_often","较多"],["ocean_mostly","很多"],["ocean_always","大量"],["ocean_insane","疯狂"]]),
  starting_swaps_descriptions: choices([["classic","经典"],["default","默认"],["highly random","高度随机"]]),
  petrification_descriptions: choices([["none","无"],["few","慢"],["default","默认"],["many","快"],["max","非常快"]]),
  speed_descriptions: choices([["never","无"],["veryslow","非常慢"],["slow","慢"],["default","默认"],["fast","快"],["veryfast","非常快"]]),
  disease_descriptions: choices([["none","无"],["random","随机"],["long","慢"],["default","默认"],["short","快"]]),
  day_descriptions: choices([["default","默认"],["longday","长白天"],["longdusk","长黄昏"],["longnight","长夜晚"],["noday","无白天"],["nodusk","无黄昏"],["nonight","无夜晚"],["onlyday","仅白天"],["onlydusk","仅黄昏"],["onlynight","仅夜晚"]]),
  season_length_descriptions: choices([["noseason","无"],["veryshortseason","非常短"],["shortseason","短"],["default","默认"],["longseason","长"],["verylongseason","非常长"],["random","随机"]]),
  season_start_descriptions: choices([["default","默认"],["winter","冬季"],["spring","春季"],["summer","夏季"],["autumn|spring","秋季或春季"],["winter|summer","冬季或夏季"],["autumn|winter|spring|summer","随机"]]),
  size_descriptions: choices([["small","小"],["medium","中"],["default","大（默认）"],["huge","巨大"]]),
  branching_descriptions: choices([["never","无"],["least","最少"],["default","默认"],["most","最多"],["random","随机"]]),
  loop_descriptions: choices([["never","无"],["default","默认"],["always","始终"]]),
  loop_plus_descriptions: choices([["never","无"],["rare","很少"],["default","默认"],["often","较多"],["always","始终"]]),
  complexity_descriptions: choices([["verysimple","非常简单"],["simple","简单"],["default","默认"],["complex","复杂"],["verycomplex","非常复杂"]]),
  specialevent_descriptions: choices([["none","无"],["default","自动"]]),
  extraevent_descriptions: choices([["default","默认"],["enabled","开启"]]),
  extrastartingitems_descriptions: choices([["0","总是"],["5","第 5 天"],["default","第 10 天"],["15","第 15 天"],["20","第 20 天"],["none","从不"]]),
  atrium_descriptions: choices([["veryslow","非常慢"],["slow","慢"],["default","默认"],["fast","快"],["veryfast","非常快"]]),
  autodetect: choices([["never","关闭"],["default","自动"],["always","开启"]]),
  yesno_descriptions: choices([["never","关闭"],["default","默认"]]),
  dropeverythingondespawn_descriptions: choices([["default","默认"],["always","全部掉落"]]),
  spawnmode_descriptions: choices([["fixed","绚丽之门"],["scatter","随机位置"]]),
  enableddisabled_descriptions: choices([["none","关闭"],["always","开启"]]),
  ghostenabled_descriptions: choices([["none","重新选人"],["always","变成幽灵"]]),
  resetime_descriptions: choices([["none","关闭"],["slow","慢"],["default","默认"],["fast","快"],["always","立即"]]),
  nonlethal_descriptions: choices([["nonlethal","非致命"],["default","默认"]]),
  darknessdamage_descriptions: choices([["never","无"],["rare","较少"],["default","默认"],["often","较多"]]),
  lessdamagetaken_descriptions: choices([["always","较少"],["none","默认"],["more","较多"]]),
  riftsenabled_descriptions: choices([["never","关闭"],["default","自动"],["always","开启"]]),
  "tasksets.GetGenTaskLists": choices([["default","默认"],["classic","经典"],["cave_default","默认洞穴"]]),
  "startlocations.GetGenStartLocations": choices([["default","默认"],["plus","额外资源"],["darkness","黑暗"],["caves","洞穴"]])
};

const categories = [
  { category: "worldgen", start: "local WORLDGEN_GROUP = {", end: "local WORLDGEN_MISC" },
  { category: "settings", start: "local WORLDSETTINGS_GROUP = {", end: "local WORLDSETTINGS_MISC" }
];
const definitions = [];

for (const section of categories) {
  const start = source.indexOf(section.start);
  const end = source.indexOf(section.end, start);
  if (start < 0 || end < 0) throw new Error(`Cannot locate ${section.category} section`);
  const lines = source.slice(start, end).split(/\r?\n/);
  let group = null;
  let groupLabel = "";
  let groupDescription = "";
  let inItems = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ");
    const indent = line.match(/^ */)?.[0].length || 0;
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue;
    const groupMatch = indent === 4 ? trimmed.match(/^\["([a-zA-Z0-9_]+)"\]\s*=\s*\{$/) : null;
    if (groupMatch) {
      group = groupMatch[1];
      groupLabel = group;
      groupDescription = "";
      inItems = false;
      continue;
    }
    if (!group) continue;
    if (!inItems && /^text\s*=/.test(trimmed)) {
      const context = trimmed.match(/(STRINGS\.[A-Z0-9_.]+)/)?.[1];
      groupLabel = context ? translations.get(context) || humanize(group) : humanize(group);
      continue;
    }
    if (!inItems && /^desc\s*=/.test(trimmed)) {
      groupDescription = trimmed.match(/^desc\s*=\s*([a-zA-Z0-9_.]+)/)?.[1] || "";
      continue;
    }
    if (/^items\s*=\s*\{/.test(trimmed) || /^items\s*=\{/.test(trimmed)) { inItems = true; continue; }
    if (!inItems) continue;
    const itemMatch = trimmed.match(/^\["([a-zA-Z0-9_]+)"\]\s*=\s*\{(.+)\},?$/);
    if (!itemMatch || !/\bimage\s*=/.test(itemMatch[2])) continue;
    const key = itemMatch[1];
    const body = itemMatch[2];
    const defaultValue = body.match(/\bvalue\s*=\s*"([^"]+)"/)?.[1] || "default";
    const itemDescription = body.match(/\bdesc\s*=\s*([a-zA-Z0-9_.]+)/)?.[1] || groupDescription;
    const worldBody = body.match(/\bworld\s*=\s*\{([^}]*)\}/)?.[1];
    let worlds = worldBody
      ? [...worldBody.matchAll(/"(forest|cave)"/g)].map((match) => match[1] === "forest" ? "master" : "caves")
      : ["master", "caves"];
    if (/\bmaster_controlled\s*=\s*true/.test(body)) worlds = worlds.filter((world) => world === "master");
    worlds = [...new Set(worlds)];
    if (!worlds.length) worlds = ["master"];
    const labelContext = `STRINGS.UI.CUSTOMIZATIONSCREEN.${key.toUpperCase()}`;
    const itemChoices = choiceSets[itemDescription] || choices([[defaultValue, "默认"]]);
    definitions.push({
      key,
      label: translations.get(labelContext) || humanize(key),
      category: section.category,
      group,
      groupLabel,
      worlds,
      defaultValue,
      choices: itemChoices,
      icon: icons[key]
    });
  }
}

definitions.sort((left, right) => left.category.localeCompare(right.category) || left.group.localeCompare(right.group) || left.label.localeCompare(right.label, "zh-CN"));
fs.writeFileSync(outputFile, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");

const missingLabels = definitions.filter((item) => item.label === humanize(item.key));
const missingChoices = definitions.filter((item) => item.choices.length === 1 && item.choices[0].value === item.defaultValue);
const missingIcons = definitions.filter((item) => !item.icon);
console.log(JSON.stringify({ total: definitions.length, worldgen: definitions.filter((item) => item.category === "worldgen").length, settings: definitions.filter((item) => item.category === "settings").length, missingLabels: missingLabels.map((item) => item.key), missingChoices: missingChoices.map((item) => item.key), missingIcons: missingIcons.map((item) => item.key) }, null, 2));

function choices(values) { return values.map(([value, label]) => ({ value, label })); }
function humanize(value) { return value.split("_").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" "); }
function parsePo(content) {
  const result = new Map();
  const expression = /msgctxt "((?:\\.|[^"\\])*)"\r?\nmsgid "(?:\\.|[^"\\])*"\r?\nmsgstr "((?:\\.|[^"\\])*)"/g;
  for (const match of content.matchAll(expression)) result.set(unescapePo(match[1]), unescapePo(match[2]));
  return result;
}
function unescapePo(value) { try { return JSON.parse(`"${value}"`); } catch { return value; } }
