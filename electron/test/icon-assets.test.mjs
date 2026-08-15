import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const iconPngUrl = new URL("../build/icon.png", import.meta.url);
const iconSvgUrl = new URL("../build/icon.svg", import.meta.url);
const faviconUrl = new URL("../../packages/viewer/public/favicon.svg", import.meta.url);

test("패키징 아이콘은 승인된 1024px RGBA Time Coil 자산이다", async () => {
  const png = await readFile(iconPngUrl);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.equal(
    createHash("sha256").update(png).digest("hex"),
    "7c36a9d5cc40dae1e7dfb5e05348fea5cd956e7c939258e984295bd248b1ae99",
  );
});

test("앱 아이콘과 파비콘은 같은 흑백 시간축 나선을 사용한다", async () => {
  const [iconSvg, favicon] = await Promise.all([
    readFile(iconSvgUrl, "utf8"),
    readFile(faviconUrl, "utf8"),
  ]);

  for (const svg of [iconSvg, favicon]) {
    assert.match(svg, /M512 846V174/);
    assert.match(svg, /#F7F7F4/);
    assert.match(svg, /#171918/);
    assert.doesNotMatch(svg, /linearGradient|#1f7147|#79C999|#17643D/i);
  }
});
