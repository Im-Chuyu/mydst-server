import catalogData from "./workshop-catalog.json" with { type: "json" };

export interface WorkshopItem {
  id: string;
  title: string;
  previewUrl: string;
  author?: string;
}

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

export async function searchWorkshop(query: string, limit = 12): Promise<WorkshopItem[]> {
  const text = query.trim();
  if (/^\d{5,12}$/.test(text)) return resolveWorkshopDetails([text]);

  const cacheKey = `${normalize(text)}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const terms = normalize(text).split(/\s+/).filter(Boolean);
  const offline = offlineCatalog
    .filter((item) => terms.every((term) => normalize(`${item.title} ${item.id}`).includes(term)))
    .sort((left, right) => score(left.title, text) - score(right.title, text))
    .slice(0, limit);

  let liveIds: string[] = [];
  let liveError: unknown;
  try {
    liveIds = await searchWorkshopIds(text, limit * 2);
  } catch (error) {
    liveError = error;
  }

  const ids = [...new Set([...liveIds, ...offline.map((item) => item.id)])].slice(0, Math.max(limit * 2, limit));
  if (!ids.length) {
    if (liveError) throw new Error(`Steam 官方搜索线路当前不可用，且离线索引中没有“${text}”。仍可使用 Workshop ID 添加`);
    return [];
  }

  try {
    const items = (await getWorkshopDetails(ids))
      .sort((left, right) => score(left.title, text) - score(right.title, text))
      .slice(0, limit);
    searchCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, items });
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
    const offline = offlineById.get(id);
    if (offline) {
      resolved.set(id, offline);
      continue;
    }
    const cached = detailsCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.item) resolved.set(id, cached.item);
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

async function searchWorkshopIds(text: string, limit: number): Promise<string[]> {
  const controller = new AbortController();
  try {
    const html = await Promise.any(workshopSearchOrigins.map(async (origin) => {
      const url = new URL("/workshop/browse/", origin);
      url.searchParams.set("appid", String(appId));
      url.searchParams.set("searchtext", text);
      url.searchParams.set("browsesort", "textsearch");
      url.searchParams.set("section", "readytouseitems");
      url.searchParams.set("actualsort", "textsearch");
      url.searchParams.set("p", "1");
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 MyDST-Panel/1.0", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      });
      if (!response.ok) throw new Error(`${origin} returned ${response.status}`);
      const body = await response.text();
      if (body.length < 5_000 || (!body.includes("322330") && !body.includes("Don't Starve Together"))) {
        throw new Error(`${origin} returned an invalid workshop page`);
      }
      return body;
    }));
    return extractWorkshopIds(html, limit);
  } catch (error) {
    if (error instanceof AggregateError) throw new Error("All Steam Community search origins failed");
    throw error;
  } finally {
    controller.abort();
  }
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

export async function getWorkshopDetails(ids: string[]): Promise<WorkshopItem[]> {
  if (!ids.length) return [];
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  const response = await fetch(detailsEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MyDST-Panel/1.0" },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Steam 详情接口返回 ${response.status}`);
  const payload = await response.json() as { response?: { publishedfiledetails?: Array<Record<string, unknown>> } };
  return (payload.response?.publishedfiledetails || []).flatMap((item) => {
    const id = String(item.publishedfileid || "");
    const title = String(item.title || "").trim();
    const tags = Array.isArray(item.tags) ? item.tags.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || !("tag" in entry)) return [];
      return [String((entry as { tag: unknown }).tag)];
    }) : [];
    const isMod = tags.some((tag) => ["client_only_mod", "server_only_mod", "all_clients_require_mod"].includes(tag));
    if (!id || !title || !isMod || Number(item.consumer_app_id) !== appId || Number(item.result) !== 1) return [];
    return [{ id, title, previewUrl: String(item.preview_url || ""), author: String(item.creator || "") }];
  });
}
