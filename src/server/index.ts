import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { ZodError } from "zod";
import { config } from "./config.js";
import { gameConfig } from "./game-config.js";
import { api } from "./routes.js";
import { startScheduler } from "./scheduler.js";

gameConfig.ensureLayout();

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet({
  strictTransportSecurity: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://images.steamusercontent.com", "https://steamuserimages-a.akamaihd.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(cookieParser());
app.use("/api", api);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message || "提交的数据格式不正确", issues: error.issues });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "上传文件超过 2GB 限制" : error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "服务器内部错误";
  console.error(error);
  res.status(500).json({ error: message });
});

const clientRoot = path.join(config.panelRoot, "dist", "client");
if (fs.existsSync(clientRoot)) {
  app.use(express.static(clientRoot, { maxAge: config.env === "production" ? "1d" : 0 }));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientRoot, "index.html")));
}

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`MyDST panel listening on http://0.0.0.0:${config.port}`);
  console.log(`Runtime root: ${config.root}${config.demo ? " (demo mode)" : ""}`);
});

const scheduler = startScheduler();

function shutdown() {
  clearInterval(scheduler);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
