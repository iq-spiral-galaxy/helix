#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { FileHelixStore } from "@iq-helix/core";
import { createApp } from "./server.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const root = arg("--root", process.env.HELIX_ROOT ?? join(homedir(), "helix"));
const port = Number(arg("--port", "4180"));
const hostname = arg("--host", process.env.HELIX_HOST ?? "127.0.0.1");
const store = new FileHelixStore(root);

serve({ fetch: createApp(store).fetch, port, hostname }, () => {
  console.log(`iq-helix viewer → http://${hostname}:${port}  (root: ${root})`);
});
