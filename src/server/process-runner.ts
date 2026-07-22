import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let pendingOut = "";
    let pendingErr = "";

    const emit = (chunk: Buffer, error = false) => {
      const text = chunk.toString("utf8");
      if (error) stderr += text;
      else stdout += text;
      const combined = (error ? pendingErr : pendingOut) + text;
      const lines = combined.split(/\r?\n/);
      const pending = lines.pop() || "";
      if (error) pendingErr = pending;
      else pendingOut = pending;
      lines.filter(Boolean).forEach((line) => options.onLine?.(line));
    };

    child.stdout.on("data", (chunk: Buffer) => emit(chunk));
    child.stderr.on("data", (chunk: Buffer) => emit(chunk, true));
    child.on("error", reject);

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`命令执行超时：${command}`));
        }, options.timeoutMs)
      : undefined;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (pendingOut) options.onLine?.(pendingOut);
      if (pendingErr) options.onLine?.(pendingErr);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
