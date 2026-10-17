import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractWorkshopItems, getFreshWorkshopVersions, searchWorkshop, workshopIdFromQuery } from "../dist/server/workshop-service.js";
import { installedWorkshopIds, installedWorkshopVersions, removeWorkshopRecords, repairWorkshopManifest } from "../dist/server/steam-workshop-manifest.js";

const item = (id, title = "[DST] Legion") => ({ publishedfileid: id, title, consumer_appid: 322330, file_type: 0, preview_url: "https://images.steamusercontent.com/cover.png", tags: [{ tag: "all_clients_require_mod" }] });
function page(items) {
  const data = { loaderData: [JSON.stringify({ queryData: JSON.stringify({ queries: [{ state: { data: { results: items } } }] }) })] };
  return `<html>322330<script type="application/json" id="valve-ssr-data">${JSON.stringify(data)}</script>${" ".repeat(5100)}</html>`;
}

test("read Steam SSR metadata without evaluating scripts and exclude other games and collections", () => {
  const html = page([item("1392778117"), { ...item("1234567890"), consumer_appid: 440 }, { ...item("1234567891"), file_type: 2 }, { ...item("1234567892"), tags: [] }]);
  assert.deepEqual(extractWorkshopItems(html).map((m) => ({ id: m.id, title: m.title })), [{ id: "1392778117", title: "[DST] Legion" }]);
  assert.deepEqual(extractWorkshopItems('<script>throw new Error("must not execute")</script>'), []);
  assert.equal(workshopIdFromQuery("https://steamcommunity.com/sharedfiles/filedetails/?id=1392778117&searchtext=legion"), "1392778117");
  assert.equal(workshopIdFromQuery("1392778117"), "1392778117");
  assert.equal(workshopIdFromQuery("https://evil.example/sharedfiles/filedetails/?id=1392778117"), undefined);
});

test("search survives an unavailable details API, shares duplicate requests and reuses cached metadata", async () => {
  const original = globalThis.fetch;
  let apiCalls = 0;
  let browseCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.steampowered.com")) { apiCalls++; throw new Error("API timeout"); }
    browseCalls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(page([item("9999911111", "Unique Legion Search Test")]));
  };
  try {
    const [first, second] = await Promise.all([searchWorkshop("Unique Legion Search Test"), searchWorkshop("Unique Legion Search Test")]);
    assert.equal(first[0].id, "9999911111");
    assert.deepEqual(first, second);
    assert.equal(apiCalls, 0, "SSR data should avoid an extra details call");
    assert.equal(browseCalls, 3, "only one search across the three official origins");
    assert.deepEqual(await searchWorkshop("Unique Legion Search Test"), first);
    assert.equal(browseCalls, 3);
    assert.equal((await searchWorkshop("9999911111"))[0].id, "9999911111");
  } finally { globalThis.fetch = original; }
});

test("numeric and Steam URL lookup fall back to SSR when the details API is down", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.steampowered.com")) throw new Error("API timeout");
    return new Response(page([item("9999922222")]));
  };
  try {
    assert.equal((await searchWorkshop("https://steamcommunity.com/sharedfiles/filedetails/?id=9999922222"))[0].id, "9999922222");
  } finally { globalThis.fetch = original; }
});

test("offline catalog remains usable when all live search routes fail", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.ok((await searchWorkshop("Geometric Placement")).some((m) => m.id === "351325790")); }
  finally { globalThis.fetch = original; }
});

test("an empty fast search origin cannot hide results from another origin", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.steampowered.com")) throw new Error("must use SSR data");
    if (String(url).includes("steamcommunity-a.akamaihd.net")) return new Response(page([]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(page([item("9999933333", "Unique Empty Origin Test")]));
  };
  try { assert.equal((await searchWorkshop("Unique Empty Origin Test"))[0].id, "9999933333"); }
  finally { globalThis.fetch = original; }
});

test("startup version metadata bypasses cached search results and keeps 64-bit manifest IDs as strings", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ response: { publishedfiledetails: [{ ...item("1392778117"), result: 1, hcontent_file: calls === 1 ? "8145995609209102369" : "8145995609209102370", time_updated: 123456 }] } }));
  };
  try {
    const mods = [{ id: "1392778117", name: "[DST] Legion" }];
    assert.equal((await getFreshWorkshopVersions(mods))[0].manifestId, "8145995609209102369");
    assert.equal((await getFreshWorkshopVersions(mods))[0].manifestId, "8145995609209102370");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("startup falls back to fresh Steam page metadata when the API is blocked", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.steampowered.com")) throw new Error("blocked");
    return new Response(page([{ ...item("1392778117"), hcontent_file: "8145995609209102369", time_updated: 123456 }]));
  };
  try { assert.equal((await getFreshWorkshopVersions([{ id: "1392778117", name: "[DST] Legion" }]))[0].manifestId, "8145995609209102369"); }
  finally { globalThis.fetch = original; }
});

test("translated local names use the current published title when looking up version metadata", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.steampowered.com")) throw new Error("blocked");
    if (String(url).includes("/sharedfiles/filedetails/")) return new Response('<meta property="og:title" content="Steam Workshop::Published English Title">');
    const query = new URL(url).searchParams.get("searchtext");
    return new Response(page(query === "Published English Title" ? [{ ...item("9999944444", "Published English Title"), hcontent_file: "8145995609209102369" }] : []));
  };
  try { assert.equal((await getFreshWorkshopVersions([{ id: "9999944444", name: "本地中文名称" }]))[0].manifestId, "8145995609209102369"); }
  finally { globalThis.fetch = original; }
});

const manifest = String.raw`"AppWorkshop" { "appid" "322330" "UnknownField" "preserve" // comment with { braces }
  "WorkshopItemsInstalled" { "3257434319" { "manifest" "1234567890123456789" } "1392778117" { "manifest" "8145995609209102369" } }
  "WorkshopItemDetails" { "3257434319" { "title" "Escaped \" text" } "1392778117" { "title" "Legion" } }
}`;

test("manifest cleanup removes only selected records and preserves 64-bit IDs and unknown fields", () => {
  const valid = manifest;
  assert.deepEqual(installedWorkshopIds(valid), ["3257434319", "1392778117"]);
  const repaired = removeWorkshopRecords(valid, new Set(["3257434319"]));
  assert.deepEqual(installedWorkshopIds(repaired), ["1392778117"]);
  assert.equal(installedWorkshopVersions(repaired).get("1392778117").manifestId, "8145995609209102369");
  assert.ok(!repaired.includes('"3257434319"'));
  assert.ok(repaired.includes('"8145995609209102369"'));
  assert.ok(repaired.includes('"UnknownField" "preserve"'));
});

test("stale manifest records are repaired before the next download; chunks and valid installed mods remain", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-workshop-manifest-"));
  try {
    const file = path.join(root, "appworkshop_322330.acf");
    const source = '"AppWorkshop" { "appid" "322330" "WorkshopItemsInstalled" { "3257434319" {"size" "10"} "1392778117" {"size" "20"} } "WorkshopItemDetails" { "3257434319" {"title" "Deleted"} } }';
    fs.writeFileSync(file, source);
    const valid = path.join(root, "content", "322330", "1392778117");
    fs.mkdirSync(valid, { recursive: true });
    fs.writeFileSync(path.join(valid, "modinfo.lua"), "name='Legion'");
    const pending = path.join(root, "downloads", "322330", "1392778117");
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, "partial-chunk"), "resume-data");
    assert.deepEqual(repairWorkshopManifest(root), ["3257434319"]);
    assert.deepEqual(installedWorkshopIds(fs.readFileSync(file, "utf8")), ["1392778117"]);
    assert.equal(fs.readFileSync(`${file}.mydst-backup`, "utf8"), source);
    assert.equal(fs.readFileSync(path.join(pending, "partial-chunk"), "utf8"), "resume-data");
    assert.deepEqual(repairWorkshopManifest(root), []);
    assert.deepEqual(repairWorkshopManifest(root, ["1392778117"]), ["1392778117"]);
    assert.deepEqual(installedWorkshopIds(fs.readFileSync(file, "utf8")), []);
    assert.throws(() => removeWorkshopRecords('"AppWorkshop" { "WorkshopItemsInstalled" {', new Set(["3257434319"])), /括号/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
