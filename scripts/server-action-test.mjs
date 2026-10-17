import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { test } from "node:test";

test("real-mode start returns a progress job; failed updates are reported without a successful start", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydst-action-test-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const fixture = `
    const {config}=await import('./dist/server/config.js');config.demo=false;
    const {game}=await import('./dist/server/game-service.js');
    let running=false;
    game.status=async()=>({installed:true,configured:true,master:{running,session:'test'},caves:{running:false,session:'test'}});
    game.action=async(action,target,log=()=>{})=>{
      if(action==='stop'){running=false;return;}
      log('正在更新模组');await new Promise(resolve=>setTimeout(resolve,300));
      if(target==='master')throw new Error('模组更新失败，启动已取消');
      running=true;
    };
    await import('./dist/server/index.js');
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", fixture], { env: { ...process.env, MYDST_ROOT: root, PORT: String(port), NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}/api`;
  try {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      if (attempt > 100) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const setup = await fetch(`${base}/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "action-admin", password: "ActionTest123!" }) });
    assert.ok(setup.ok);
    const session = await setup.json();
    const headers = { "Content-Type": "application/json", Cookie: setup.headers.get("set-cookie").split(";")[0], "X-CSRF-Token": session.csrfToken };
    const action = (action, shard) => fetch(`${base}/server/action`, { method: "POST", headers, body: JSON.stringify({ action, shard }) });
    const started = await action("start", "all");
    assert.equal(started.status, 202);
    const state = await started.json();
    assert.equal(state.master.running, false);
    assert.equal(state.job.type, "server-start");
    assert.equal((await action("start", "all")).status, 409);
    async function waitForJob(id) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const jobs = await (await fetch(`${base}/jobs`, { headers })).json();
        const job = jobs.find((record) => record.id === id);
        if (job?.status !== "running") return job;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("task did not complete");
    }
    assert.equal((await waitForJob(state.job.id)).status, "success");
    const stopped = await action("stop", "all");
    assert.equal(stopped.status, 200);
    assert.equal((await stopped.json()).master.running, false);
    const failed = await (await action("start", "master")).json();
    const job = await waitForJob(failed.job.id);
    assert.equal(job.status, "failed");
    assert.match(job.error, /更新失败/);
    assert.equal((await (await fetch(`${base}/server/status`, { headers })).json()).master.running, false);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
