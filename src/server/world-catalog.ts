import catalogData from "./world-catalog-data.json" with { type: "json" };
import type { Shard } from "./types.js";

export type WorldOverrideValue = string | number | boolean;
export interface WorldChoice { value: string; label: string }
export interface WorldSettingDefinition {
  key: string;
  label: string;
  category: "worldgen" | "settings";
  group: string;
  groupLabel: string;
  worlds: Shard[];
  defaultValue: string;
  choices: WorldChoice[];
  icon?: { atlas: "worldgen" | "worldsettings"; x: number; y: number };
}

export type Playstyle = "relaxed" | "endless" | "survival" | "wilderness" | "lightsout";

export const playstylePresets: Record<Playstyle, { preset: string; label: string; overrides: Record<string, string> }> = {
  relaxed: {
    preset: "RELAXED",
    label: "轻松",
    overrides: {
      ghostsanitydrain: "none", portalresurection: "always", temperaturedamage: "nonlethal",
      hunger: "nonlethal", darkness: "nonlethal", lessdamagetaken: "always", healthpenalty: "none",
      wildfires: "never", hounds: "rare", resettime: "none", shadowcreatures: "rare", brightmarecreatures: "rare"
    }
  },
  endless: {
    preset: "ENDLESS",
    label: "无尽",
    overrides: { portalresurection: "always", basicresource_regrowth: "always", resettime: "none", ghostsanitydrain: "none" }
  },
  survival: { preset: "SURVIVAL_TOGETHER", label: "生存", overrides: {} },
  wilderness: {
    preset: "WILDERNESS",
    label: "荒野",
    overrides: { spawnmode: "scatter", basicresource_regrowth: "always", ghostenabled: "none", ghostsanitydrain: "none", resettime: "none" }
  },
  lightsout: { preset: "LIGHTS_OUT", label: "暗无天日", overrides: { start_location: "darkness", day: "onlynight" } }
};

const cavePresetOverrides: Record<string, Record<string, string>> = {
  DST_CAVE: {},
  DST_CAVE_PLUS: { boons: "often", cave_spiders: "often", rabbits: "rare", berrybush: "rare", carrot: "rare", flower_cave: "rare", wormlights: "rare", flower_cave_regrowth: "rare" },
  TERRARIA_CAVE: { boons: "often", weather: "often", wormattacks: "often", flower_cave_regrowth: "fast", mushtree_regrowth: "fast", mushtree_moon_regrowth: "fast", bats_setting: "often", spider_dropper: "often" }
};

export const worldCatalog = catalogData as WorldSettingDefinition[];
export const worldCatalogVersion = "dst-2026-07-full";

export function getPresetOverrides(shard: Shard, preset: string): Record<string, string> {
  if (shard === "caves") return cavePresetOverrides[preset] || {};
  return Object.values(playstylePresets).find((item) => item.preset === preset)?.overrides || {};
}

export function playstyleFromPreset(preset: string): Playstyle {
  return (Object.entries(playstylePresets).find(([, item]) => item.preset === preset)?.[0] as Playstyle | undefined) || "endless";
}
