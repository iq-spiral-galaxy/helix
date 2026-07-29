import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TIMEOUT_MS = 30_000;
const READY_SENTINEL = "HELIX_DESKTOP_SMOKE_READY";
const DEVELOPMENT_MODE = process.argv.includes("--development");
const require = createRequire(import.meta.url);

function packagedExecutable() {
  const candidates =
    process.platform === "darwin"
      ? process.arch === "arm64"
        ? [
            "release/mac-arm64/Helix.app/Contents/MacOS/Helix",
            "release/mac/Helix.app/Contents/MacOS/Helix",
          ]
        : [
            "release/mac/Helix.app/Contents/MacOS/Helix",
            "release/mac-x64/Helix.app/Contents/MacOS/Helix",
          ]
      : process.platform === "win32"
        ? ["release/win-unpacked/Helix.exe"]
        : [
            "release/linux-unpacked/helix",
            "release/linux-unpacked/iq-helix",
          ];
  const executable = candidates
    .map((candidate) => resolve(candidate))
    .find(existsSync);
  if (!executable) {
    throw new Error(
      `Packaged Helix executable not found. Checked:\n${candidates
        .map((candidate) => `- ${resolve(candidate)}`)
        .join("\n")}`,
    );
  }
  return executable;
}

const executable = DEVELOPMENT_MODE ? require("electron") : packagedExecutable();
const launchArgs = [
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ...(DEVELOPMENT_MODE ? [resolve(".")] : []),
];
console.log(`Smoke-testing ${executable}`);

const child = spawn(executable, launchArgs, {
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    ELECTRON_ENABLE_LOGGING: "1",
    HELIX_DESKTOP_SMOKE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  stderr += text;
  process.stderr.write(text);
});

const result = await new Promise((resolveResult, reject) => {
  let timedOut = false;
  let settled = false;
  let forceClose;
  const cleanup = () => {
    clearTimeout(timeout);
    if (forceClose) clearTimeout(forceClose);
  };
  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveResult(value);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
    forceClose = setTimeout(() => {
      finish({ code: null, signal: "SIGKILL", timedOut });
    }, 2_000);
  }, TIMEOUT_MS);
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  });
  child.once("close", (code, signal) => {
    finish({ code, signal, timedOut });
  });
});

if (result.timedOut) {
  throw new Error(
    `Helix did not finish its startup smoke test within ${TIMEOUT_MS / 1000}s.\n${stdout}\n${stderr}`,
  );
}
if (result.code !== 0) {
  throw new Error(
    `Packaged Helix exited with code ${result.code ?? "null"}${
      result.signal ? ` (${result.signal})` : ""
    }.\n${stderr}`,
  );
}
if (!stdout.includes(READY_SENTINEL)) {
  throw new Error(
    `Packaged Helix exited without the ${READY_SENTINEL} signal.\n${stdout}\n${stderr}`,
  );
}

console.log("Helix desktop startup smoke test passed.");
