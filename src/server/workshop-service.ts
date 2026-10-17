import catalogData from "./workshop-catalog.json" with { type: "json" };

export interface WorkshopItem {
  id: string;
  title: string;
  previewUrl: string;
  author?: string;
  manifestId?: string;
  updatedAt?: number;
}

export interface WorkshopVersion { id: string; manifestId?: string; updatedAt?: number }

const appId = 322330;
const detailsEndpoint = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const workshopSearchOrigins = [
  "https://steamcommunity-a.akamaihd.net",
  "https://community.akamai.steamstatic.com",
  "https://steamcommunity.com"
];
const offlineCatalog = catalogData as WorkshopItem[];
const offlineById = new Map(offlineCatalog.map((item) => [item.id, item]));
const searchCache = new Map<string, { expiresAt: number; items: WorkshopItem[] }>();
const detailsCache = new Map<string, { expiresAt: number; item: WorkshopItem | null }>();
const searchRequests = new Map<string, Promise<WorkshopItem[]>>();
const versionSearchTitles = new Map<string, string>();

export function workshopIdFromQuery(query: string): string | undefined {
  if (/^\d{5,12}$/.test(query.trim())) return query.trim();
  try {
    const url = new URL(query);
    if (!["steamcommunity.com", "www.steamcommunity.com", "steamcommunity-a.akamaihd.net"].includes(url.hostname) || !/^\/sharedfiles\/filedetails\/?$/.test(url.pathname)) return undefined;
    const id = url.searchParams.get("id") || "";
    return /^\d{5,12}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

export async function searchWorkshop(query: string, limit = 12): Promise<WorkshopItem[]> {
  const text = query.trim();
  const id = workshopIdFromQuery(text);
  if (id) {
    const known = await resolveWorkshopDetails([id]);
    if (known.length) return known;
    const live = await searchWorkshopItems(id, 12);
    const item = live.items.find((item) => item.id === id);
    if (item) { detailsCache.set(id, { expiresAt: Date.now() + 30 * 60_000, item }); return [item]; }
    throw new Error("暂时无法读取这个 Workshop ID，请确认模组公开可用后重试");
  }

  const cacheKey = `${normalize(text)}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const pending = searchRequests.get(cacheKey);
  if (pending) return pending;
  const request = searchWorkshopUncached(text, limit, cacheKey);
  searchRequests.set(cacheKey, request);
  try { return await request; }
  finally { searchRequests.delete(cacheKey); }
}

async function searchWorkshopUncached(text: string, limit: number, cacheKey: string): Promise<WorkshopItem[]> {
  const terms = normalize(text).split(/\s+/).filter(Boolean);
  const offline = offlineCatalog
    .filter((item) => terms.every((term) => normalize(`${item.title} ${item.id}`).includes(term)))
    .sort((left, right) => score(left.title, text) - score(right.title, text))
    .slice(0, limit);

  let liveIds: string[] = [];
  let liveError: unknown;
  try {
    const live = await searchWorkshopItems(text, limit * 2);
    liveIds = live.ids;
    for (const item of live.items) detailsCache.set(item.id, { expiresAt: Date.now() + 30 * 60_000, item });
  } catch (error) {
    liveError = error;
  }

  const ids = [...new Set([...liveIds, ...offline.map((item) => item.id)])].slice(0, Math.max(limit * 2, limit));
  if (!ids.length) {
    if (liveError) throw new Error(`Steam 官方搜索线路当前不可用，且离线索引中没有“${text}”。仍可使用 Workshop ID 添加`);
    return [];
  }

  try {
    const items = (await resolveWorkshopDetails(ids))
      .sort((left, right) => score(left.title, text) - score(right.title, text))
      .slice(0, limit);
    if (!items.length && liveIds.length) throw new Error("Steam 搜索有结果，但详情暂时不可用，请稍后重试或使用 Workshop ID");
    searchCache.set(cacheKey, { expiresAt: Date.now() + (liveError ? 60_000 : 10 * 60_000), items });
    return items;
  } catch (error) {
    if (!offline.length) throw error;
    const items = offline.slice(0, limit);
    searchCache.set(cacheKey, { expiresAt: Date.now() + 60_000, items });
    return items;
  }
}

export async function resolveWorkshopDetails(ids: readonly string[]): Promise<WorkshopItem[]> {
  const uniqueIds = [...new Set(ids.filter((id) => /^\d{5,12}$/.test(id)))];
  const resolved = new Map<string, WorkshopItem>();
  const pending: string[] = [];
  for (const id of uniqueIds) {
    const cached = detailsCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.item) resolved.set(id, cached.item);
      continue;
    }
    const offline = offlineById.get(id);
    if (offline) {
      resolved.set(id, offline);
      continue;
    }
    pending.push(id);
  }
  for (let offset = 0; offset < pending.length; offset += 50) {
    const batch = pending.slice(offset, offset + 50);
    try {
      const live = await getWorkshopDetails(batch);
      const liveById = new Map(live.map((item) => [item.id, item]));
      for (const id of batch) {
        const item = liveById.get(id) || null;
        detailsCache.set(id, { expiresAt: Date.now() + (item ? 30 * 60_000 : 5 * 60_000), item });
        if (item) resolved.set(id, item);
      }
    } catch {
      for (const id of batch) detailsCache.set(id, { expiresAt: Date.now() + 60_000, item: null });
    }
  }
  return uniqueIds.flatMap((id) => resolved.get(id) || []);
}

async function searchWorkshopItems(text: string, limit: number): Promise<{ ids: string[]; items: WorkshopItem[] }> {
  const controller = new AbortController();
  let emptyPage = false;
  try {
    const result = await Promise.any(workshopSearchOrigins.map(async (origin) => {
      const url = new URL("/workshop/browse/", origin);
      url.searchParams.set("appid", String(appId));
      url.searchParams.set("searchtext", text);
      url.searchParams.set("browsesort", "textsearch");
      url.searchParams.set("section", "readytouseitems");
      url.searchParams.set("actualsort", "textsearch");
      url.searchParams.set("p", "1");
      if (limit > 30) url.searchParams.set("numperpage", "100");
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 MyDST-Panel/1.0", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      });
      if (!response.ok) throw new Error(`${origin} returned ${response.status}`);
      const body = await response.text();
      if (body.length < 5_000 || (!body.includes("322330") && !body.includes("Don't Starve Together"))) {
        throw new Error(`${origin} returned an invalid workshop page`);
      }
      const items = extractWorkshopItems(body, limit);
      const ids = [...new Set([...items.map((item) => item.id), ...extractWorkshopIds(body, limit)])].slice(0, limit);
      if (!ids.length) { emptyPage = true; throw new Error("This search route returned no matching mods"); }
      return { items, ids };
    }));
    return result;
  } catch (error) {
    if (error instanceof AggregateError) {
      if (emptyPage) return { items: [], ids: [] };
      throw new Error("All Steam Community search origins failed");
    }
    throw error;
  } finally {
    controller.abort();
  }
}

export function extractWorkshopItems(html: string, limit = 12): WorkshopItem[] {
  const items = new Map<string, WorkshopItem>();
  let nodes = 0;
  function visit(value: unknown, depth = 0): void {
    if (depth > 12 || ++nodes > 50_000 || items.size >= limit) return;
    if (typeof value === "string" && value.length < 2_000_000 && /^[\[{]/.test(value.trim())) {
      try { visit(JSON.parse(value), depth + 1); } catch { /* Non-JSON descriptions are text, not executable code. */ }
    } else if (value && typeof value === "object") {
      const item = workshopItemFromRecord(value as Record<string, unknown>);
      if (item) items.set(item.id, item);
      else for (const nested of Object.values(value)) visit(nested, depth + 1);
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1]!)); } catch { /* Other page scripts need not contain JSON. */ }
  }
  return [...items.values()];
}

function workshopItemFromRecord(item: Record<string, unknown>): WorkshopItem | null {
  const id = String(item.publishedfileid || "");
  const title = String(item.title || "").trim();
  const tags = Array.isArray(item.tags) ? item.tags.flatMap((entry) => entry && typeof entry === "object" && "tag" in entry ? [String(entry.tag)] : []) : [];
  const isMod = tags.some((tag) => ["client_only_mod", "server_only_mod", "all_clients_require_mod"].includes(tag));
  if (!/^\d{5,12}$/.test(id) || !title || !isMod || Number(item.consumer_app_id ?? item.consumer_appid) !== appId ||
    item.result !== undefined && Number(item.result) !== 1 || item.file_type !== undefined && Number(item.file_type) !== 0) return null;
  const manifest = String(item.hcontent_file || "");
  const updatedAt = Number(item.time_updated);
  return { id, title, previewUrl: String(item.preview_url || ""), author: String(item.creator || ""),
    manifestId: /^\d+$/.test(manifest) && manifest !== "0" ? manifest : undefined,
    updatedAt: updatedAt > 0 ? updatedAt : undefined };
}

export function extractWorkshopIds(html: string, limit = 12): string[] {
  const ids = [...html.matchAll(/(?:data-publishedfileid=["']|sharedfiles\/filedetails\/\?id=)(\d{5,12})/gi)]
    .map((match) => match[1]!)
    .filter((id, index, all) => all.indexOf(id) === index);
  return ids.slice(0, limit);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\[[^\]]*]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function score(title: string, query: string): number {
  const normalizedTitle = normalize(title);
  const normalizedQuery = normalize(query);
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  return 2;
}

export async function getWorkshopDetails(ids: string[], timeoutMs = 15_000): Promise<WorkshopItem[]> {
  if (!ids.length) return [];
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  const response = await fetch(detailsEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MyDST-Panel/1.0" },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Steam 详情接口返回 ${response.status}`);
  const payload = await response.json() as { response?: { publishedfiledetails?: Array<Record<string, unknown>> } };
  return (payload.response?.publishedfiledetails || []).flatMap((item) => workshopItemFromRecord(item) || []);
}

// Startup checks must bypass search/detail caches and the bundled offline catalog.
export async function getFreshWorkshopVersions(mods: readonly { id: string; name: string }[]): Promise<WorkshopVersion[]> {
  const resolved = new Map<string, WorkshopVersion>();
  const hasVersion = (item: WorkshopVersion) => Boolean(item.manifestId || item.updatedAt);
  for (let offset = 0; offset < mods.length; offset += 50) {
    try {
      for (const item of await getWorkshopDetails(mods.slice(offset, offset + 50).map((mod) => mod.id), 5000)) {
        if (hasVersion(item)) resolved.set(item.id, item);
      }
    } catch { /* Official Steam Community metadata is a fallback for blocked API routes. */ }
  }
  const pending = mods.filter((mod) => !resolved.has(mod.id));
  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const mod = pending[next++]!;
      async function findVersion(title: string) {
        const query = title.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim() || title;
        try {
          const results = await searchWorkshopItems(query, 100);
          const item = results.items.find((item) => item.id === mod.id);
          if (item && hasVersion(item)) { resolved.set(mod.id, item); versionSearchTitles.set(mod.id, item.title); return true; }
        } catch { /* A renamed or translated mod can be looked up by its current published title. */ }
        return false;
      }
      const title = versionSearchTitles.get(mod.id) || mod.name || offlineById.get(mod.id)?.title || mod.id;
      if (await findVersion(title)) continue;
      try { await findVersion(await getPublishedWorkshopTitle(mod.id)); }
      catch { /* Report unresolved mod names together rather than assuming they are current. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
  const missing = mods.filter((mod) => !resolved.has(mod.id));
  if (missing.length) throw new Error(`无法检查以下模组的新版本：${missing.map((mod) => mod.name || mod.id).join("、")}，请稍后重试`);
  return mods.map((mod) => resolved.get(mod.id)!);
}

async function getPublishedWorkshopTitle(id: string): Promise<string> {
  const controller = new AbortController();
  try {
    return await Promise.any(workshopSearchOrigins.map(async (origin) => {
      const response = await fetch(`${origin}/sharedfiles/filedetails/?id=${id}&l=english`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) });
      if (!response.ok) throw new Error("无法读取模组发布名称");
      const html = await response.text();
      for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attributes = Object.fromEntries([...meta[0].matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((match) => [match[1]!.toLowerCase(), match[3]!]));
        if (attributes.property !== "og:title") continue;
        const title = (attributes.content || "").replace(/^Steam Workshop\s*::\s*/i, "")
          .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
        if (title) return title;
      }
      throw new Error("模组发布名称不可用");
    }));
  } finally { controller.abort(); }
}
