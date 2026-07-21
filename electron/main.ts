import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 3008;

let mainWindow: BrowserWindow | null = null;
let benchChild: ChildProcess | null = null;
let spawnedByUs = false;
let benchReady = false;
let lastBenchStderr = "";

function benchPort(): number {
  const raw = process.env.BENCH_MANAGER_PORT?.trim();
  const n = raw ? Number(raw) : DEFAULT_PORT;
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function benchUrl(): string {
  return (
    process.env.BENCH_MANAGER_URL?.trim() ||
    `http://127.0.0.1:${benchPort()}`
  );
}

/** Resolve Clients/web/bench-manager next to this desktop package. */
function resolveBenchWebRoot(): string {
  if (process.env.BENCH_MANAGER_WEB?.trim()) {
    return path.resolve(process.env.BENCH_MANAGER_WEB.trim());
  }
  if (process.env.WORKSPACE_ROOT?.trim()) {
    return path.resolve(
      process.env.WORKSPACE_ROOT.trim(),
      "Clients/web/bench-manager",
    );
  }
  // dist-electron → package → desktop → Clients → web/bench-manager
  return path.resolve(__dirname, "../../../web/bench-manager");
}

/** Never use process.execPath inside Electron — that is the Electron binary. */
function resolveNodeBinary(): string {
  const fromEnv = process.env.NODE_BINARY?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const execPath = process.execPath;
  const looksLikeElectron =
    /electron/i.test(execPath) || process.versions.electron !== undefined;

  if (!looksLikeElectron && fs.existsSync(execPath)) {
    return execPath;
  }

  for (const candidate of ["/usr/local/bin/node", "/usr/bin/node"]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const which = execFileSync("command", ["-v", "node"], {
      encoding: "utf8",
      env: process.env,
    })
      .trim()
      .split("\n")[0];
    if (which && !/electron/i.test(which)) return which;
  } catch {
    // fall through
  }

  throw new Error(
    "Could not find a Node.js binary to start Next.js. Set NODE_BINARY to your node path.",
  );
}

function probeUrl(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeUrl(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function spawnBenchServer(webRoot: string): ChildProcess {
  const port = String(benchPort());
  const hasBuild = fs.existsSync(path.join(webRoot, ".next"));
  const useProd = app.isPackaged && hasBuild;

  const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error(
      `next binary missing under ${webRoot}. Run pnpm install from the WorkSpace root.`,
    );
  }

  const nodeBin = resolveNodeBinary();
  const args = useProd
    ? [nextBin, "start", "--port", port]
    : [nextBin, "dev", "--port", port];

  const env = { ...process.env };
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_REGION;
  delete env.AWS_LAMBDA_FUNCTION_NAME;
  delete env.ELECTRON_RUN_AS_NODE;

  lastBenchStderr = "";
  const child = spawn(nodeBin, args, {
    cwd: webRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Keep attached so we can kill cleanly; detached was unnecessary.
    detached: false,
  });

  child.stdout?.on("data", (buf: Buffer) => {
    process.stdout.write(`[bench-web] ${buf.toString()}`);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const text = buf.toString();
    lastBenchStderr = `${lastBenchStderr}${text}`.slice(-4000);
    process.stderr.write(`[bench-web] ${text}`);
  });

  return child;
}

async function ensureBenchServer(): Promise<{ url: string; error?: string }> {
  const url = benchUrl();
  if (await probeUrl(url)) {
    spawnedByUs = false;
    benchReady = true;
    return { url };
  }

  const webRoot = resolveBenchWebRoot();
  if (!fs.existsSync(path.join(webRoot, "package.json"))) {
    return {
      url,
      error: `Bench Manager web app not found at ${webRoot}. Set BENCH_MANAGER_WEB or WORKSPACE_ROOT.`,
    };
  }

  try {
    benchChild = spawnBenchServer(webRoot);
  } catch (err) {
    return {
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  spawnedByUs = true;
  benchReady = false;

  benchChild.on("exit", (code, signal) => {
    const wasReady = benchReady;
    benchChild = null;
    if (!spawnedByUs) return;
    if (wasReady && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Bench Manager",
        message: `Next.js server exited (code ${code ?? "null"}, signal ${signal ?? "none"}).`,
        detail: lastBenchStderr.trim() || undefined,
      });
    }
  });

  const ready = await waitForUrl(url);
  if (!ready) {
    const detail = lastBenchStderr.trim();
    stopBenchServer();
    return {
      url,
      error: detail
        ? `Timed out waiting for ${url}.\n\n${detail}`
        : `Timed out waiting for ${url}. Check Clients/web/bench-manager (.env.local, pnpm install).`,
    };
  }
  benchReady = true;
  return { url };
}

function stopBenchServer() {
  if (!spawnedByUs || !benchChild) return;
  const child = benchChild;
  spawnedByUs = false;
  benchReady = false;
  benchChild = null;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "ZatGo Bench Manager",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot() {
  createWindow();
  if (!mainWindow) return;

  // Brief splash from Vite while Next boots (dev only)
  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  const result = await ensureBenchServer();
  if (result.error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Bench Manager",
      message: result.error,
      detail:
        "This desktop app wraps the local Next.js ops console (Docker + SSH). It cannot run cloud ops from a packaged remote host alone.",
    });
    return;
  }

  void mainWindow.loadURL(result.url);
}

ipcMain.handle("desktop:getAppVersion", () => app.getVersion());
ipcMain.handle("desktop:getPlatform", () => process.platform);
ipcMain.handle("desktop:getBenchUrl", () => benchUrl());
ipcMain.handle("desktop:getBenchWebRoot", () => resolveBenchWebRoot());

app.whenReady().then(() => {
  void boot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void boot();
    }
  });
});

app.on("before-quit", () => {
  stopBenchServer();
});

app.on("window-all-closed", () => {
  stopBenchServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
