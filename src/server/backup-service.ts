import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ini from "ini";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { config } from "./config.js";
import { runCommand } from "./process-runner.js";

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

interface ZipInspection { prefix: string; entries: number; uncompressedBytes: number }

const requiredClusterFiles = ["cluster.ini", "Master/server.ini", "Caves/server.ini"];
const maxZipEntries = 50_000;
const maxUncompressedBytes = 8 * 1024 * 1024 * 1024;

export class BackupService {
  list(): BackupInfo[] {
    fs.mkdirSync(config.backupRoot, { recursive: true, mode: 0o750 });
    return fs.readdirSync(config.backupRoot)
      .filter((name) => isArchiveName(name))
      .map((name) => {
        const stat = fs.statSync(path.join(config.backupRoot, name));
        return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(label: string | undefined, onLine: (line: string) => void): Promise<BackupInfo> {
    const safeLabel = sanitizeLabel(label || "manual");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const name = `${stamp}_${safeLabel}.tar.gz`;
    const destination = path.join(config.backupRoot, name);
    fs.mkdirSync(config.backupRoot, { recursive: true, mode: 0o750 });
    if (config.demo) {
      fs.writeFileSync(destination, "MyDST demo backup\n", { mode: 0o640 });
    } else {
      if (!fs.existsSync(config.clusterRoot)) throw new Error("集群目录不存在");
      onLine("正在压缩 Cluster_1 存档...");
      const result = await runCommand("tar", ["-czf", destination, "-C", path.dirname(config.clusterRoot), path.basename(config.clusterRoot)], { timeoutMs: 20 * 60_000, onLine });
      if (result.code !== 0) throw new Error(result.stderr || "存档备份失败");
    }
    const stat = fs.statSync(destination);
    return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
  }

  async validate(nameOrFile: string): Promise<void> {
    const file = path.isAbsolute(nameOrFile) ? nameOrFile : this.resolve(nameOrFile);
    if (file.toLowerCase().endsWith(".zip")) {
      const inspection = await inspectZip(file);
      const configs = await Promise.all(requiredClusterFiles.map((name) => readZipText(file, `${inspection.prefix}${name}`, 256 * 1024)));
      validateConfigContents(configs[0]!, configs[1]!, configs[2]!);
      return;
    }
    if (!config.demo) await inspectTar(file);
  }

  async restore(name: string, onLine: (line: string) => void): Promise<void> {
    const file = this.resolve(name);
    if (config.demo) {
      if (file.toLowerCase().endsWith(".zip")) {
        await this.restoreZip(file, onLine);
        return;
      }
      onLine("[演示模式] 存档校验和恢复完成");
      return;
    }
    if (file.toLowerCase().endsWith(".zip")) await this.restoreZip(file, onLine);
    else await this.restoreTar(file, onLine);
  }

  private async restoreTar(file: string, onLine: (line: string) => void): Promise<void> {
    await inspectTar(file);
    await this.swapCluster(async (temporaryRoot) => {
      onLine("正在安全释放 tar.gz 存档...");
      const result = await runCommand("tar", ["-xzf", file, "--no-same-owner", "--no-same-permissions", "-C", temporaryRoot], { timeoutMs: 20 * 60_000, onLine });
      if (result.code !== 0) throw new Error(result.stderr || "存档释放失败");
      validateExtractedCluster(path.join(temporaryRoot, "Cluster_1"));
    });
  }

  private async restoreZip(file: string, onLine: (line: string) => void): Promise<void> {
    const inspection = await inspectZip(file);
    await this.swapCluster(async (temporaryRoot) => {
      const destination = path.join(temporaryRoot, "Cluster_1");
      fs.mkdirSync(destination, { recursive: true, mode: 0o750 });
      onLine(`正在安全释放 ZIP（${inspection.entries} 个条目）...`);
      await extractZip(file, inspection.prefix, destination);
      validateExtractedCluster(destination);
    });
  }

  private async swapCluster(extract: (temporaryRoot: string) => Promise<void>): Promise<void> {
    const parent = path.dirname(config.clusterRoot);
    const temporaryRoot = path.join(parent, `.mydst-restore-${Date.now()}`);
    const oldPath = `${config.clusterRoot}.restore-${Date.now()}`;
    fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o750 });
    try {
      await extract(temporaryRoot);
      if (fs.existsSync(config.clusterRoot)) fs.renameSync(config.clusterRoot, oldPath);
      fs.renameSync(path.join(temporaryRoot, "Cluster_1"), config.clusterRoot);
      fs.rmSync(oldPath, { recursive: true, force: true });
    } catch (error) {
      if (!fs.existsSync(config.clusterRoot) && fs.existsSync(oldPath)) fs.renameSync(oldPath, config.clusterRoot);
      throw error;
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  delete(name: string): void { fs.rmSync(this.resolve(name)); }

  resolve(name: string): string {
    if (name !== path.basename(name) || !isArchiveName(name)) throw new Error("无效的备份文件名");
    const file = path.join(config.backupRoot, name);
    if (!fs.existsSync(file)) throw new Error("备份文件不存在");
    return file;
  }

  prune(retentionCount: number): void { this.list().slice(retentionCount).forEach((backup) => fs.rmSync(this.resolve(backup.name))); }
}

async function inspectTar(file: string): Promise<void> {
  const [names, verbose] = await Promise.all([
    runCommand("tar", ["-tzf", file], { timeoutMs: 60_000 }),
    runCommand("tar", ["-tvzf", file], { timeoutMs: 60_000 })
  ]);
  if (names.code !== 0 || verbose.code !== 0) throw new Error("备份文件损坏或格式不受支持");
  const entries = names.stdout.split(/\r?\n/).filter(Boolean).map(normalizeArchivePath);
  if (!entries.length || entries.length > maxZipEntries || entries.some((entry) => !entry.startsWith("Cluster_1/") && entry !== "Cluster_1")) throw new Error("备份必须只包含 Cluster_1 目录");
  if (verbose.stdout.split(/\r?\n/).some((line) => /^[lh]/.test(line))) throw new Error("备份中不允许符号链接或硬链接");
  for (const required of requiredClusterFiles) if (!entries.includes(`Cluster_1/${required}`)) throw new Error(`备份缺少 ${required}`);
}

async function inspectZip(file: string): Promise<ZipInspection> {
  const zip = await openZip(file);
  const names: string[] = [];
  let count = 0;
  let total = 0;
  try {
    await walkZip(zip, async (entry) => {
      count += 1;
      if (count > maxZipEntries) throw new Error("ZIP 文件条目过多");
      const name = normalizeArchivePath(entry.fileName);
      validateZipEntry(entry, name);
      names.push(name);
      total += entry.uncompressedSize;
      if (total > maxUncompressedBytes) throw new Error("ZIP 解压后超过 8GB 限制");
    });
  } finally { zip.close(); }
  const clusterIni = names.find((name) => name === "cluster.ini" || name.endsWith("/Cluster_1/cluster.ini") || name === "Cluster_1/cluster.ini");
  if (!clusterIni) throw new Error("ZIP 中未找到 Cluster_1/cluster.ini");
  const prefix = clusterIni.slice(0, -"cluster.ini".length);
  if (prefix.split("/").filter(Boolean).length > 2) throw new Error("ZIP 存档目录嵌套过深");
  for (const required of requiredClusterFiles) if (!names.includes(`${prefix}${required}`)) throw new Error(`ZIP 存档缺少 ${required}`);
  const meaningful = names.filter((name) => !name.endsWith("/") && !name.startsWith("__MACOSX/"));
  if (meaningful.some((name) => !name.startsWith(prefix))) throw new Error("ZIP 包含 Cluster_1 之外的文件");
  return { prefix, entries: count, uncompressedBytes: total };
}

function validateZipEntry(entry: Entry, name: string): void {
  if (!name || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..") || entry.fileName.includes("\\")) throw new Error("ZIP 包含不安全路径");
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  if ((unixMode & 0o170000) === 0o120000) throw new Error("ZIP 中不允许符号链接");
  if (entry.uncompressedSize > 2 * 1024 * 1024 * 1024) throw new Error("ZIP 中单个文件超过 2GB");
  if (entry.uncompressedSize > 100 * 1024 * 1024 && (!entry.compressedSize || entry.uncompressedSize / entry.compressedSize > 1000)) throw new Error("ZIP 压缩比异常，疑似压缩炸弹");
}

async function extractZip(file: string, prefix: string, destination: string): Promise<void> {
  const zip = await openZip(file);
  try {
    await walkZip(zip, async (entry) => {
      const name = normalizeArchivePath(entry.fileName);
      validateZipEntry(entry, name);
      if (!name.startsWith(prefix)) return;
      const relative = name.slice(prefix.length);
      if (!relative) return;
      const target = path.resolve(destination, ...relative.split("/"));
      if (target !== destination && !target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error("ZIP 目标路径越界");
      if (name.endsWith("/")) { fs.mkdirSync(target, { recursive: true, mode: 0o750 }); return; }
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
      const stream = await openEntryStream(zip, entry);
      await pipeline(stream, fs.createWriteStream(target, { mode: 0o640 }));
    });
  } finally { zip.close(); }
}

function validateExtractedCluster(root: string): void {
  for (const required of requiredClusterFiles) if (!fs.existsSync(path.join(root, ...required.split("/")))) throw new Error(`解压后的存档缺少 ${required}`);
  validateConfigContents(
    fs.readFileSync(path.join(root, "cluster.ini"), "utf8"),
    fs.readFileSync(path.join(root, "Master", "server.ini"), "utf8"),
    fs.readFileSync(path.join(root, "Caves", "server.ini"), "utf8")
  );
}

function validateConfigContents(clusterText: string, masterText: string, cavesText: string): void {
  const cluster = ini.parse(clusterText);
  const master = ini.parse(masterText);
  const caves = ini.parse(cavesText);
  if (!cluster.NETWORK || !cluster.GAMEPLAY) throw new Error("cluster.ini 缺少 NETWORK 或 GAMEPLAY 配置");
  if (!master.SHARD || !master.NETWORK || String(master.SHARD.is_master).toLowerCase() !== "true") throw new Error("Master/server.ini 不是有效的地面分片配置");
  if (!caves.SHARD || !caves.NETWORK || String(caves.SHARD.is_master).toLowerCase() === "true") throw new Error("Caves/server.ini 不是有效的洞穴分片配置");
}

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error || new Error("无法打开 ZIP")) : resolve(zip)));
}

function walkZip(zip: ZipFile, visitor: (entry: Entry) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.once("error", reject);
    zip.on("entry", (entry) => { void visitor(entry).then(() => zip.readEntry()).catch(reject); });
    zip.once("end", resolve);
    zip.readEntry();
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error || new Error("ZIP 条目无法读取")) : resolve(stream)));
}

async function readZipText(file: string, target: string, maxBytes: number): Promise<string> {
  const zip = await openZip(file);
  try {
    return await new Promise<string>((resolve, reject) => {
      zip.once("error", reject);
      zip.on("entry", (entry) => {
        if (normalizeArchivePath(entry.fileName) !== target) { zip.readEntry(); return; }
        if (entry.uncompressedSize > maxBytes) { reject(new Error(`${target} 文件异常过大`)); return; }
        void openEntryStream(zip, entry).then(async (stream) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          resolve(Buffer.concat(chunks).toString("utf8"));
        }).catch(reject);
      });
      zip.once("end", () => reject(new Error(`ZIP 存档缺少 ${target}`)));
      zip.readEntry();
    });
  } finally { zip.close(); }
}

function normalizeArchivePath(value: string): string { return value.replace(/^\.\//, "").replace(/\/{2,}/g, "/"); }
function isArchiveName(name: string): boolean { const lower = name.toLowerCase(); return lower.endsWith(".tar.gz") || lower.endsWith(".zip"); }
function sanitizeLabel(value: string): string { return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "backup"; }

export const backups = new BackupService();
