import test from "node:test";
import assert from "node:assert/strict";
import {
  assetNameFor,
  checksumFromRelease,
  compareVersions,
  isTrustedReleaseUrl,
  normalizeVersion,
  selectUpdateAsset,
} from "../update-core.mjs";

test("버전을 정규화하고 semver 순서로 비교한다", () => {
  assert.equal(normalizeVersion("v0.2.0"), "0.2.0");
  assert.equal(normalizeVersion("latest"), null);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("0.2.0", "0.2.0-beta.2") > 0);
  assert.ok(compareVersions("1.0.0-alpha-a", "1.0.0-alpha-b") < 0);
});

test("플랫폼별 릴리스 자산 이름을 결정한다", () => {
  assert.equal(assetNameFor("0.2.0", "darwin", "arm64"), "Helix-0.2.0-arm64.dmg");
  assert.equal(assetNameFor("0.2.0", "darwin", "x64"), "Helix-0.2.0-x64.dmg");
  assert.equal(assetNameFor("0.2.0", "win32", "x64"), "Helix-Setup-0.2.0-x64.exe");
  assert.equal(assetNameFor("0.2.0", "linux", "x64"), "Helix-0.2.0-x64.AppImage");
  assert.equal(assetNameFor("0.2.0", "linux", "arm64"), null);
});

test("GitHub digest와 checksum 파일을 모두 검증 소스로 쓸 수 있다", () => {
  const hash = "a".repeat(64);
  assert.equal(checksumFromRelease({ digest: `sha256:${hash}` }), hash);
  assert.equal(
    checksumFromRelease(
      { name: "Helix-0.2.0-arm64.dmg" },
      `${hash}  Helix-0.2.0-arm64.dmg\n`,
    ),
    hash,
  );
});

test("공식 Helix 릴리스 자산만 업데이트 URL로 허용한다", () => {
  const url =
    "https://github.com/iq-spiral-galaxy/helix/releases/download/v0.2.0/Helix-0.2.0-arm64.dmg";
  assert.equal(isTrustedReleaseUrl(url), true);
  assert.equal(isTrustedReleaseUrl("https://example.com/Helix.dmg"), false);
});

test("릴리스에서 현재 플랫폼의 정확한 자산만 고른다", () => {
  const chosen = selectUpdateAsset(
    {
      tag_name: "v0.2.0",
      assets: [
        {
          name: "Helix-0.2.0-arm64.dmg",
          browser_download_url:
            "https://github.com/iq-spiral-galaxy/helix/releases/download/v0.2.0/Helix-0.2.0-arm64.dmg",
        },
      ],
    },
    "darwin",
    "arm64",
  );
  assert.equal(chosen?.version, "0.2.0");
  assert.equal(chosen?.asset.name, "Helix-0.2.0-arm64.dmg");
});
