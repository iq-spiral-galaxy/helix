import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
const expected = `v${packageJson.version}`;

if (!tag) {
  console.error("릴리스 태그가 필요합니다.");
  process.exit(1);
}
if (tag !== expected) {
  console.error(`태그(${tag})와 package.json 버전(${expected})이 다릅니다.`);
  process.exit(1);
}
console.log(`릴리스 버전 확인: ${expected}`);
