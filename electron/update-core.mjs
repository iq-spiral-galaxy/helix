const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function normalizeVersion(value) {
  const version = String(value ?? "").trim().replace(/^v/, "");
  return VERSION_RE.test(version) ? version : null;
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) throw new TypeError("유효한 semver 버전이 필요합니다.");

  const aSeparator = a.indexOf("-");
  const bSeparator = b.indexOf("-");
  const aCore = aSeparator < 0 ? a : a.slice(0, aSeparator);
  const bCore = bSeparator < 0 ? b : b.slice(0, bSeparator);
  const aPre = aSeparator < 0 ? "" : a.slice(aSeparator + 1);
  const bPre = bSeparator < 0 ? "" : b.slice(bSeparator + 1);
  const aParts = aCore.split(".").map(Number);
  const bParts = bCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (aParts[index] !== bParts[index]) return aParts[index] - bParts[index];
  }
  if (aPre === bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  return aPre.localeCompare(bPre, "en", {
    numeric: true,
    sensitivity: "base",
  });
}

export function assetNameFor(version, platform, arch) {
  const safeVersion = normalizeVersion(version);
  if (!safeVersion) throw new TypeError("업데이트 버전이 올바르지 않습니다.");

  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return `Helix-${safeVersion}-${arch}.dmg`;
  }
  if (platform === "win32" && arch === "x64") {
    return `Helix-Setup-${safeVersion}-x64.exe`;
  }
  if (platform === "linux" && arch === "x64") {
    return `Helix-${safeVersion}-x64.AppImage`;
  }
  return null;
}

export function checksumFromRelease(asset, checksumText = "") {
  const direct = String(asset?.digest ?? "").match(/^sha256:([a-f0-9]{64})$/i);
  if (direct) return direct[1].toLowerCase();

  const wanted = String(asset?.name ?? "");
  for (const line of String(checksumText).split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === wanted) return match[1].toLowerCase();
  }
  return null;
}

export function selectUpdateAsset(release, platform, arch) {
  const version = normalizeVersion(release?.tag_name);
  if (!version) return null;
  const name = assetNameFor(version, platform, arch);
  if (!name) return null;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) => candidate?.name === name)
    : null;
  if (!asset || typeof asset.browser_download_url !== "string") return null;
  return { version, asset };
}

export function isTrustedReleaseUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith("/iq-spiral-galaxy/helix/releases/download/")
    );
  } catch {
    return false;
  }
}
