import { readFile } from "node:fs/promises";
const READINESS_FILE = "/tmp/snipsik-ready";

try {
  const timestamp = Number(await readFile(READINESS_FILE, "utf8"));
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 15_000 || timestamp > Date.now()) {
    process.exit(1);
  }
} catch {
  process.exit(1);
}
