import assert from "node:assert/strict";
import { test } from "node:test";
import { AnnouncementService, announcementSlot } from "../dist/server/announcement-service.js";
import { announcementsSchema } from "../dist/server/validation.js";

function fixture(overrides = {}) {
  const state = {
    announcements: { enabled: true, mode: "interval", intervalMinutes: 10, times: ["20:00", "21:00"], onlyWhenPlayersOnline: true, messages: ["第一段", "第二段"], ...overrides },
    announcementRuntime: { revision: "test", lastSentAt: 0, nextMessageIndex: 0, lastScheduledSlot: null }
  };
  const sent = [];
  const errors = [];
  const dependencies = {
    snapshot: () => structuredClone(state),
    saveRuntime: (runtime) => { state.announcementRuntime = runtime; },
    isRunning: async () => true,
    players: async () => [{ shard: "caves" }],
    announce: async (message) => { sent.push(message); },
    isBusy: () => false,
    reportError: (error) => errors.push(error)
  };
  return { state, sent, errors, dependencies, service: new AnnouncementService(dependencies) };
}

test("interval waits for cooldown, rotates one message per send, and resumes after restart", async () => {
  const f = fixture();
  await f.service.tick(599_999);
  assert.deepEqual(f.sent, []);
  await f.service.tick(600_000);
  await f.service.tick(600_010);
  await f.service.tick(1_200_000);
  assert.deepEqual(f.sent, ["第一段", "第二段"]);
  const restarted = new AnnouncementService(f.dependencies);
  await restarted.tick(1_200_001);
  assert.equal(f.sent.length, 2);
  await restarted.tick(1_800_000);
  assert.deepEqual(f.sent, ["第一段", "第二段", "第一段"]);
});

test("empty room, stopped master, and active maintenance do not consume a message", async () => {
  const f = fixture();
  f.dependencies.players = async () => [];
  await f.service.tick(600_000);
  f.dependencies.players = async () => [{ shard: "caves" }];
  f.dependencies.isRunning = async () => false;
  await f.service.tick(1_200_000);
  f.dependencies.isRunning = async () => true;
  f.dependencies.isBusy = () => true;
  await f.service.tick(1_800_000);
  assert.deepEqual(f.sent, []);
  assert.equal(f.state.announcementRuntime.nextMessageIndex, 0);
  f.dependencies.isBusy = () => false;
  await f.service.tick(3_600_000);
  await f.service.tick(3_600_001);
  assert.deepEqual(f.sent, ["第一段"], "no backlog burst when a player returns");
});

test("single message repeats and the online-only condition is optional", async () => {
  const f = fixture({ messages: ["欢迎"], onlyWhenPlayersOnline: false });
  f.dependencies.players = async () => { throw new Error("must not query players"); };
  await f.service.tick(600_000);
  await f.service.tick(1_200_000);
  assert.deepEqual(f.sent, ["欢迎", "欢迎"]);
});

test("daily uses Shanghai time, sends once per slot across restarts, and skips missed slots", async () => {
  const f = fixture({ mode: "daily" });
  const at = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(announcementSlot(at), "2026-10-12 20:00");
  assert.equal(announcementSlot(Date.parse("2026-10-12T16:00:00Z")), "2026-10-13 00:00");
  await f.service.tick(at - 1000);
  await f.service.tick(at);
  await new AnnouncementService(f.dependencies).tick(at + 10_000);
  await f.service.tick(at + 61_000);
  await f.service.tick(at + 3_600_000);
  assert.deepEqual(f.sent, ["第一段", "第二段"]);
  f.dependencies.players = async () => [];
  await f.service.tick(at + 86_400_000);
  f.dependencies.players = async () => [{}];
  await f.service.tick(at + 86_461_000);
  assert.equal(f.sent.length, 2, "missed daily announcements are not queued");
  await f.service.tick(at + 90_000_000);
  assert.deepEqual(f.sent, ["第一段", "第二段", "第一段"]);
});

test("failed sends keep the current message and retry with backoff", async () => {
  const f = fixture();
  f.dependencies.announce = async () => { throw new Error("tmux unavailable"); };
  await f.service.tick(600_000);
  await f.service.tick(610_000);
  assert.equal(f.errors.length, 1);
  assert.equal(f.state.announcementRuntime.lastSentAt, 0);
  assert.equal(f.state.announcementRuntime.nextMessageIndex, 0);
  f.dependencies.announce = async (message) => f.sent.push(message);
  await f.service.tick(630_000);
  assert.deepEqual(f.sent, ["第一段"]);
});

test("overlapping ticks cannot send duplicates, and edits cancel a pending send", async () => {
  const f = fixture();
  let release;
  f.dependencies.players = () => new Promise((resolve) => { release = resolve; });
  const pending = f.service.tick(600_000);
  await Promise.resolve();
  await f.service.tick(600_000);
  f.state.announcements.enabled = false;
  f.state.announcementRuntime.revision = "edited";
  release([{}]);
  await pending;
  assert.deepEqual(f.sent, []);
});

test("settings reject invalid intervals, empty enabled contents, duplicate times and control characters", () => {
  const { state } = fixture();
  const valid = state.announcements;
  for (const patch of [{ intervalMinutes: 0 }, { intervalMinutes: 1.5 }, { messages: [] }, { messages: ["  "] }, { messages: ["a\0b"] }, { messages: ["a".repeat(501)] }, { times: ["25:00"] }, { times: ["20:00", "20:00"] }, { mode: "daily", times: [] }]) {
    assert.equal(announcementsSchema.safeParse({ ...valid, ...patch }).success, false);
  }
  assert.equal(announcementsSchema.safeParse({ ...valid, messages: ["你好\n世界"] }).success, true);
  assert.equal(announcementsSchema.safeParse({ ...valid, enabled: false, messages: [], times: [] }).success, true);
});
