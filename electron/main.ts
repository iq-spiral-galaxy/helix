import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from "electron";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { FileHelixStore } from "@iq-helix/core";
import { createApp } from "@iq-helix/viewer";
import {
  checksumFromRelease,
  compareVersions,
  isTrustedReleaseUrl,
  normalizeVersion,
  selectUpdateAsset,
} from "./update-core.mjs";

declare const __HELIX_VERSION__: string;

const PRODUCT_NAME = "Helix";
const APP_ID = "com.iq-lab.helix";
const RELEASES_URL = "https://github.com/iq-spiral-galaxy/helix/releases/latest";
const RELEASES_API =
  "https://api.github.com/repos/iq-spiral-galaxy/helix/releases/latest";
const RELEASE_CACHE_MS = 10 * 60 * 1000;

app.setName(PRODUCT_NAME);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "helix",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const APP_ROOT = app.getAppPath();
const USER_DATA = app.getPath("userData");
const CONFIG_PATH = join(USER_DATA, "desktop.json");
const UPDATE_DIR = join(USER_DATA, "updates");
const UPDATE_MARKER = join(USER_DATA, "pending-update.json");
const UPDATE_LOG = join(USER_DATA, "last-update.log");

type DesktopConfig = { dataRoot?: string };
type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  digest?: string | null;
};
type ReleaseData = {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
};
type UpdateCandidate = {
  release: ReleaseData;
  version: string;
  asset: ReleaseAsset;
  checksum?: string;
};

let mainWindow: BrowserWindow | null = null;
let dataRoot = "";
let updateCandidate: UpdateCandidate | null = null;
let releaseCacheAt = 0;
let updateBusy = false;

function readDesktopConfig(): DesktopConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as DesktopConfig;
  } catch {
    return {};
  }
}

function writeDesktopConfig(config: DesktopConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function resolveDataRoot(): string {
  const saved = readDesktopConfig().dataRoot;
  const candidates = [
    saved,
    process.env.HELIX_ROOT,
    join(homedir(), "spiral-galaxy", "helix"),
    join(homedir(), "helix"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? join(homedir(), "helix");
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function safeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:", "obsidian:"].includes(url.protocol);
  } catch {
    return false;
  }
}

async function registerHelixProtocol(): Promise<void> {
  const store = new FileHelixStore(dataRoot);
  await store.init();
  const publicDir = join(APP_ROOT, "packages", "viewer", "public");
  const webApp = createApp(store, { publicDir });

  protocol.handle("helix", async (request) => {
    const incoming = new URL(request.url);
    const target = new URL(
      `${incoming.pathname}${incoming.search}`,
      "http://helix.local",
    );
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    return webApp.fetch(
      new Request(target, {
        method: request.method,
        headers: request.headers,
      }),
    );
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: "#f7f7f6",
    autoHideMenuBar: true,
    icon: join(APP_ROOT, "electron", "build", "icon.png"),
    webPreferences: {
      preload: join(APP_ROOT, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("helix://app/")) return;
    event.preventDefault();
    if (safeExternalUrl(url)) void shell.openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL("helix://app/");
  return window;
}

async function fetchReleaseJson(): Promise<ReleaseData> {
  const response = await fetch(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `helix/${__HELIX_VERSION__}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub 릴리스 확인 실패 (HTTP ${response.status})`);
  }
  return (await response.json()) as ReleaseData;
}

function publicUpdateResult(
  candidate: UpdateCandidate | null,
  error?: unknown,
): Record<string, unknown> {
  const latest = candidate?.version ?? null;
  return {
    current: __HELIX_VERSION__,
    latest,
    updateAvailable:
      Boolean(latest) && compareVersions(latest as string, __HELIX_VERSION__) > 0,
    publishedAt: candidate?.release.published_at ?? null,
    releaseUrl: candidate?.release.html_url ?? RELEASES_URL,
    supported: Boolean(candidate),
    ...(error
      ? { error: error instanceof Error ? error.message : String(error) }
      : {}),
  };
}

async function checkForUpdate(force = false): Promise<Record<string, unknown>> {
  if (!app.isPackaged) {
    return {
      current: __HELIX_VERSION__,
      latest: null,
      updateAvailable: false,
      supported: false,
      releaseUrl: RELEASES_URL,
      error: "개발 모드에서는 앱 업데이트를 실행하지 않습니다.",
    };
  }
  if (
    !force &&
    updateCandidate &&
    Date.now() - releaseCacheAt < RELEASE_CACHE_MS
  ) {
    return publicUpdateResult(updateCandidate);
  }
  try {
    const release = await fetchReleaseJson();
    const selected = selectUpdateAsset(release, process.platform, process.arch);
    releaseCacheAt = Date.now();
    if (!selected) {
      updateCandidate = null;
      const latest = normalizeVersion(release.tag_name);
      return {
        current: __HELIX_VERSION__,
        latest,
        updateAvailable:
          Boolean(latest) && compareVersions(latest as string, __HELIX_VERSION__) > 0,
        supported: false,
        releaseUrl: release.html_url ?? RELEASES_URL,
        error: "현재 운영체제용 자동 업데이트 파일이 없습니다.",
      };
    }
    if (!isTrustedReleaseUrl(selected.asset.browser_download_url)) {
      throw new Error("신뢰할 수 없는 업데이트 주소를 거부했습니다.");
    }
    updateCandidate = { release, ...selected };
    return publicUpdateResult(updateCandidate);
  } catch (error) {
    updateCandidate = null;
    return publicUpdateResult(null, error);
  }
}

async function expectedChecksum(candidate: UpdateCandidate): Promise<string> {
  const direct = checksumFromRelease(candidate.asset);
  if (direct) return direct;

  const checksumAsset = candidate.release.assets?.find(
    (asset) => asset.name === "SHA256SUMS.txt",
  );
  if (
    !checksumAsset ||
    !isTrustedReleaseUrl(checksumAsset.browser_download_url)
  ) {
    throw new Error("업데이트 체크섬을 찾을 수 없습니다.");
  }
  const response = await fetch(checksumAsset.browser_download_url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("업데이트 체크섬을 받지 못했습니다.");
  const checksum = checksumFromRelease(candidate.asset, await response.text());
  if (!checksum) throw new Error("업데이트 체크섬에 현재 파일이 없습니다.");
  return checksum;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadUpdate(
  candidate: UpdateCandidate,
  expected: string,
): Promise<string> {
  await mkdir(UPDATE_DIR, { recursive: true });
  const name = basename(candidate.asset.name);
  if (name !== candidate.asset.name) {
    throw new Error("업데이트 파일 이름이 올바르지 않습니다.");
  }
  const partialPath = join(UPDATE_DIR, `${name}.download`);
  const finalPath = join(UPDATE_DIR, name);
  await rm(partialPath, { force: true });

  const response = await fetch(candidate.asset.browser_download_url, {
    redirect: "follow",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`업데이트 다운로드 실패 (HTTP ${response.status})`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const output = createWriteStream(partialPath, { flags: "wx" });
  const outputFinished = finished(output);
  void outputFinished.catch(() => {});
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      received += bytes.byteLength;
      if (!output.write(bytes)) {
        await Promise.race([once(output, "drain"), outputFinished]);
      }
      const percent = total > 0 ? Math.round((received / total) * 100) : null;
      broadcast("desktop:update-progress", { received, total, percent });
    }
    output.end();
    await outputFinished;
  } catch (error) {
    output.destroy();
    await rm(partialPath, { force: true });
    throw error;
  }

  const actual = await sha256(partialPath);
  if (actual !== expected) {
    await rm(partialPath, { force: true });
    throw new Error("업데이트 파일 체크섬이 일치하지 않습니다.");
  }
  await rm(finalPath, { force: true });
  await rename(partialPath, finalPath);
  return finalPath;
}

function shellQuote(value: string): string {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function currentMacBundle(): string {
  const marker = `${sep}Contents${sep}MacOS${sep}`;
  const index = process.execPath.indexOf(marker);
  const bundle = index >= 0 ? process.execPath.slice(0, index) : "/Applications/Helix.app";
  return bundle.endsWith(".app") ? bundle : "/Applications/Helix.app";
}

async function writePendingMarker(candidate: UpdateCandidate): Promise<void> {
  await mkdir(USER_DATA, { recursive: true });
  await writeFile(
    UPDATE_MARKER,
    JSON.stringify(
      {
        targetVersion: candidate.version,
        fromVersion: __HELIX_VERSION__,
        releaseUrl: candidate.release.html_url ?? RELEASES_URL,
        logPath: UPDATE_LOG,
        at: Date.now(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function installMac(
  filePath: string,
  candidate: UpdateCandidate,
): Promise<Record<string, unknown>> {
  const target = currentMacBundle();
  const scriptPath = join(UPDATE_DIR, `install-${candidate.version}.sh`);
  const script = `#!/bin/bash
set -u
exec >> ${shellQuote(UPDATE_LOG)} 2>&1
echo "=== Helix update ${__HELIX_VERSION__} -> ${candidate.version} ==="
DMG=${shellQuote(filePath)}
TARGET=${shellQuote(target)}
STAGED="\${TARGET}.update"
BACKUP="\${TARGET}.previous"
MOUNT=""
SUCCESS=0
cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach -quiet "$MOUNT" 2>/dev/null || true; fi
  if [ "$SUCCESS" -ne 1 ]; then
    if [ ! -d "$TARGET" ] && [ -d "$BACKUP" ]; then mv "$BACKUP" "$TARGET"; fi
    if [ -d "$TARGET" ]; then open "$TARGET" 2>/dev/null || true; fi
  fi
}
trap cleanup EXIT
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.4; done
MOUNT=$(hdiutil attach -nobrowse "$DMG" | tail -1 | sed 's/^.*\t//')
SOURCE=$(find "$MOUNT" -maxdepth 1 -type d -name 'Helix.app' -print -quit)
if [ -z "$SOURCE" ]; then echo "Helix.app not found"; exit 1; fi
rm -rf -- "$STAGED" "$BACKUP"
ditto "$SOURCE" "$STAGED" || exit 1
if [ -d "$TARGET" ]; then mv "$TARGET" "$BACKUP" || exit 1; fi
if mv "$STAGED" "$TARGET"; then
  xattr -cr "$TARGET" 2>/dev/null || true
  open "$TARGET"
  SUCCESS=1
  rm -rf -- "$BACKUP"
else
  [ -d "$BACKUP" ] && mv "$BACKUP" "$TARGET"
  exit 1
fi
`;
  await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  await writePendingMarker(candidate);
  const child = spawn("/bin/bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  setTimeout(() => app.quit(), 400);
  return { ok: true, mode: "macos" };
}

async function installWindows(
  filePath: string,
  candidate: UpdateCandidate,
): Promise<Record<string, unknown>> {
  await writePendingMarker(candidate);
  const child = spawn(filePath, ["/S", "--force-run"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  setTimeout(() => app.quit(), 700);
  return { ok: true, mode: "windows" };
}

async function installLinux(
  filePath: string,
  candidate: UpdateCandidate,
): Promise<Record<string, unknown>> {
  const target = process.env.APPIMAGE;
  if (!target || !existsSync(target)) {
    await shell.openExternal(candidate.release.html_url ?? RELEASES_URL);
    return { ok: true, mode: "browser" };
  }
  const scriptPath = join(UPDATE_DIR, `install-${candidate.version}.sh`);
  const script = `#!/bin/sh
set -u
exec >> ${shellQuote(UPDATE_LOG)} 2>&1
SOURCE=${shellQuote(filePath)}
TARGET=${shellQuote(target)}
STAGED="\${TARGET}.update"
BACKUP="\${TARGET}.previous"
SUCCESS=0
recover() {
  if [ "$SUCCESS" -ne 1 ]; then
    if [ ! -e "$TARGET" ] && [ -e "$BACKUP" ]; then mv "$BACKUP" "$TARGET"; fi
    if [ -x "$TARGET" ]; then "$TARGET" >/dev/null 2>&1 & fi
  fi
}
trap recover EXIT
while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done
rm -f -- "$STAGED" "$BACKUP"
cp "$SOURCE" "$STAGED" || exit 1
chmod +x "$STAGED" || exit 1
mv "$TARGET" "$BACKUP" || exit 1
if mv "$STAGED" "$TARGET"; then
  "$TARGET" >/dev/null 2>&1 &
  SUCCESS=1
  rm -f -- "$BACKUP"
else
  mv "$BACKUP" "$TARGET"
  exit 1
fi
`;
  await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  await writePendingMarker(candidate);
  const child = spawn("/bin/sh", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  setTimeout(() => app.quit(), 400);
  return { ok: true, mode: "linux" };
}

async function installAvailableUpdate(): Promise<Record<string, unknown>> {
  if (!app.isPackaged) {
    return {
      ok: false,
      error: "개발 모드에서는 앱 업데이트를 설치하지 않습니다.",
    };
  }
  if (updateBusy) return { ok: false, error: "업데이트가 이미 진행 중입니다." };
  updateBusy = true;
  try {
    if (!updateCandidate) await checkForUpdate(true);
    const candidate = updateCandidate;
    if (!candidate) throw new Error("설치할 업데이트가 없습니다.");
    if (compareVersions(candidate.version, __HELIX_VERSION__) <= 0) {
      throw new Error("이미 최신 버전입니다.");
    }
    const checksum = await expectedChecksum(candidate);
    const filePath = await downloadUpdate(candidate, checksum);
    const fileInfo = await stat(filePath);
    if (fileInfo.size < 1_000_000) {
      throw new Error("다운로드된 업데이트 파일이 비정상적으로 작습니다.");
    }
    if (process.platform === "darwin") return installMac(filePath, candidate);
    if (process.platform === "win32") return installWindows(filePath, candidate);
    if (process.platform === "linux") return installLinux(filePath, candidate);
    throw new Error("현재 운영체제에서는 자동 업데이트를 지원하지 않습니다.");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    updateBusy = false;
  }
}

async function checkPendingUpdate(): Promise<void> {
  let marker:
    | { targetVersion?: string; releaseUrl?: string; logPath?: string }
    | undefined;
  try {
    marker = JSON.parse(await readFile(UPDATE_MARKER, "utf8"));
  } catch {
    return;
  }
  await rm(UPDATE_MARKER, { force: true });
  const targetVersion = normalizeVersion(marker?.targetVersion);
  if (!targetVersion || compareVersions(__HELIX_VERSION__, targetVersion) >= 0) {
    return;
  }
  const options: MessageBoxOptions = {
    type: "warning",
    title: "Helix 업데이트",
    message: `v${targetVersion} 업데이트를 완료하지 못했습니다.`,
    detail: `현재 버전은 v${__HELIX_VERSION__}입니다. 릴리스에서 다시 설치하거나 로그를 확인해 주세요.`,
    buttons: ["릴리스 열기", "로그 보기", "닫기"],
    defaultId: 0,
    cancelId: 2,
  };
  const choice = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (choice.response === 0) {
    await shell.openExternal(marker?.releaseUrl ?? RELEASES_URL);
  } else if (choice.response === 1 && marker?.logPath) {
    shell.showItemInFolder(marker.logPath);
  }
}

function registerDesktopIpc(): void {
  ipcMain.handle("desktop:get-info", () => ({
    version: __HELIX_VERSION__,
    dataRoot,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  }));
  ipcMain.handle("desktop:choose-data-root", async () => {
    const options: OpenDialogOptions = {
      title: "Helix 데이터 폴더 선택",
      defaultPath: dataRoot,
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "이 폴더 사용",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const nextRoot = result.filePaths[0];
    writeDesktopConfig({ ...readDesktopConfig(), dataRoot: nextRoot });
    return { canceled: false, dataRoot: nextRoot, restartRequired: true };
  });
  ipcMain.handle("desktop:reveal-data-root", () => shell.openPath(dataRoot));
  ipcMain.handle("desktop:restart", () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("desktop:check-update", (_event, force = false) =>
    checkForUpdate(Boolean(force)),
  );
  ipcMain.handle("desktop:install-update", () => installAvailableUpdate());
  ipcMain.handle("desktop:open-releases", () => shell.openExternal(RELEASES_URL));
}

async function boot(): Promise<void> {
  dataRoot = resolveDataRoot();
  await mkdir(dataRoot, { recursive: true });
  await registerHelixProtocol();
  registerDesktopIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  mainWindow = createMainWindow();
  await checkPendingUpdate();
  setTimeout(() => {
    void checkForUpdate(false).then((result) => {
      if (result.updateAvailable) broadcast("desktop:update-available", result);
    });
  }, 2500);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(async () => {
      app.setAppUserModelId(APP_ID);
      await boot();
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Helix 시작 실패",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});
