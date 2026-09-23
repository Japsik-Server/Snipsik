import { describe, expect, it } from "bun:test";
import { copyFile, mkdtemp, chmod, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function scenario(options: { schemaFail?: boolean; newHealth?: string; killAt?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snipsik-deploy-test-"));
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  await Bun.$`mkdir -p ${bin} ${state}`.quiet();
  await copyFile(join(root, "test/fixtures/fake-docker.sh"), join(bin, "docker"));
  await copyFile(join(root, "test/fixtures/fake-gcloud.sh"), join(bin, "gcloud"));
  await chmod(join(bin, "docker"), 0o755);
  await chmod(join(bin, "gcloud"), 0o755);
  await symlink("/bin/true", join(bin, "sleep"));
  await writeFile(join(dir, "env"), "DATABASE_URL=file:test.db\n");
  await writeFile(join(state, "snipsik-bot"), "old-image|true|healthy\n");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_DOCKER_STATE: state,
    MOCK_SCHEMA_FAIL: options.schemaFail ? "1" : "0",
    MOCK_NEW_HEALTH: options.newHealth ?? "healthy",
    MOCK_KILL_AT: options.killAt ?? "",
  };
  const run = async () => {
    const process = Bun.spawn(["bash", "scripts/deploy.sh", "new-image", "snipsik-bot", "us-central1", join(dir, "env")], {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await process.exited;
    const output = await new Response(process.stdout).text() + await new Response(process.stderr).text();
    return { code, output };
  };
  const containers = async () => {
    const names = ["snipsik-bot", "snipsik-bot-backup", "snipsik-bot-candidate"];
    const found: Record<string, string> = {};
    for (const name of names) {
      try { found[name] = (await readFile(join(state, name), "utf8")).trim(); } catch {}
    }
    return found;
  };
  return { run, containers, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("deploy switch and recovery", () => {
  it("blocks schema mismatch before touching the old bot", async () => {
    const test = await scenario({ schemaFail: true });
    try {
      expect((await test.run()).code).not.toBe(0);
      expect(await test.containers()).toEqual({ "snipsik-bot": "old-image|true|healthy" });
    } finally { await test.cleanup(); }
  });

  it("promotes the healthy candidate and removes the backup", async () => {
    const test = await scenario();
    try {
      expect((await test.run()).code).toBe(0);
      expect(await test.containers()).toEqual({ "snipsik-bot": "new-image|true|healthy" });
    } finally { await test.cleanup(); }
  });

  it("rolls back a running but unready candidate", async () => {
    const test = await scenario({ newHealth: "unhealthy" });
    try {
      expect((await test.run()).code).not.toBe(0);
      expect(await test.containers()).toEqual({ "snipsik-bot": "old-image|true|healthy" });
    } finally { await test.cleanup(); }
  });

  for (const killAt of ["stop", "rename-backup", "rename-primary", "start-new"]) {
    it(`recovers after SIGKILL at ${killAt} and reruns cleanly`, async () => {
      const test = await scenario({ killAt });
      try {
        expect((await test.run()).code).not.toBe(0);
        expect((await test.run()).code).toBe(0);
        expect(await test.containers()).toEqual({ "snipsik-bot": "new-image|true|healthy" });
      } finally { await test.cleanup(); }
    });
  }
});
