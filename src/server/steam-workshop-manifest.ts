import fs from "node:fs";
import path from "node:path";

interface Entry { key: string; value?: string; children?: Entry[]; start: number; end: number }

function parseManifest(source: string): Entry[] {
  const tokens = [...source.matchAll(/\/\/[^\n]*|"(?:\\.|[^"\\])*"|[{}]|[^\s"{}]+/g)].filter((match) => !match[0].startsWith("//"));
  let position = 0;
  const text = (token: string) => token.startsWith('"') ? token.slice(1, -1).replace(/\\(["\\])/g, "$1") : token;
  function entries(nested: boolean): Entry[] {
    const result: Entry[] = [];
    while (position < tokens.length) {
      const key = tokens[position++]!;
      if (key[0] === "}") { if (!nested) throw new Error("Workshop 索引括号不匹配"); return result; }
      if (key[0] === "{") throw new Error("Workshop 索引格式无效");
      const value = tokens[position++];
      if (!value || value[0] === "}") throw new Error("Workshop 索引缺少值");
      if (value[0] === "{") {
        const children = entries(true);
        const end = tokens[position - 1]!;
        result.push({ key: text(key[0]), children, start: key.index!, end: end.index! + end[0].length });
      } else result.push({ key: text(key[0]), value: text(value[0]), start: key.index!, end: value.index! + value[0].length });
    }
    if (nested) throw new Error("Workshop 索引括号不匹配");
    return result;
  }
  return entries(false);
}

export function installedWorkshopIds(source: string): string[] {
  const root = parseManifest(source).find((entry) => entry.key === "AppWorkshop");
  return root?.children?.find((entry) => entry.key === "WorkshopItemsInstalled")?.children?.map((entry) => entry.key).filter((id) => /^\d{5,12}$/.test(id)) || [];
}

export interface InstalledWorkshopVersion { manifestId?: string; updatedAt?: number }

export function installedWorkshopVersions(source: string): Map<string, InstalledWorkshopVersion> {
  const root = parseManifest(source).find((entry) => entry.key === "AppWorkshop");
  const items = root?.children?.find((entry) => entry.key === "WorkshopItemsInstalled")?.children || [];
  return new Map(items.filter((item) => /^\d{5,12}$/.test(item.key)).map((item) => {
    const manifestId = item.children?.find((entry) => entry.key === "manifest")?.value;
    const updatedAt = Number(item.children?.find((entry) => entry.key === "timeupdated")?.value);
    return [item.key, { manifestId: manifestId && manifestId !== "0" ? manifestId : undefined, updatedAt: updatedAt > 0 ? updatedAt : undefined }];
  }));
}

export function removeWorkshopRecords(source: string, ids: ReadonlySet<string>): string {
  const root = parseManifest(source).find((entry) => entry.key === "AppWorkshop");
  const removals = (root?.children || []).filter((entry) => entry.key.startsWith("WorkshopItems") || entry.key === "WorkshopItemDetails")
    .flatMap((entry) => entry.children || []).filter((entry) => ids.has(entry.key)).sort((a, b) => b.start - a.start);
  for (const entry of removals) source = source.slice(0, entry.start) + source.slice(entry.end);
  return source;
}

export function repairWorkshopManifest(workshopRoot: string, removeIds: readonly string[] = []): string[] {
  const file = path.join(workshopRoot, "appworkshop_322330.acf");
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, "utf8");
  const removed = new Set(removeIds);
  for (const id of installedWorkshopIds(source)) {
    if (!fs.existsSync(path.join(workshopRoot, "content", "322330", id, "modinfo.lua"))) removed.add(id);
  }
  const next = removeWorkshopRecords(source, removed);
  if (next !== source) {
    // Keep the last original manifest for recovery. Never remove downloaded chunks.
    fs.copyFileSync(file, `${file}.mydst-backup`);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, next, { mode: fs.statSync(file).mode & 0o777 });
    fs.renameSync(temporary, file);
  }
  return [...removed];
}
