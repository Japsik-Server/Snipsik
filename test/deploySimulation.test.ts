import { describe, expect, it } from "bun:test";
import { copyFile, mkdtemp, chmod, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function scenario(options: { schemaFail?: boolean; newHealth?: string; killAt?: string; failRestoreRename?: boolean; oldHealth?: string; backup?: boolean; failBackupRemove?: boolean; sudoGcloudFail?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snipsik-deploy-test-"));
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  await Bun.$`mkdir -p ${bin} ${state}`.quiet();
  await copyFile(join(root, "test/fixtures/fake-docker.sh"), join(bin, "docker"));
  await copyFile(join(root, "test/fixtures/fake-gcloud.sh"), join(bin, "gcloud"));
  await copyFile(join(root, "test/fixtures/fake-sudo.sh"), join(bin, "sudo"));
  await chmod(join(bin, "docker"), 0o755);
  await chmod(join(bin, "gcloud"), 0o755);
  await chmod(join(bin, "sudo"), 0o755);
  await symlink("/bin/true", join(bin, "sleep"));
  await writeFile(join(dir, "env"), "DATABASE_URL=file:test.db\n");
  await writeFile(join(state, "snipsik-bot"), `old-image|true|${options.oldHealth ?? "healthy"}\n`);
  if (options.backup) await writeFile(join(state, "snipsik-bot-backup"), "stale-image|false|healthy\n");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_DOCKER_STATE: state,
    MOCK_SCHEMA_FAIL: options.schemaFail ? "1" : "0",
    MOCK_NEW_HEALTH: options.newHealth ?? "healthy",
    MOCK_KILL_AT: options.killAt ?? "",
    MOCK_FAIL_RESTORE_RENAME: options.failRestoreRename ? "1" : "0",
    MOCK_FAIL_BACKUP_REMOVE: options.failBackupRemove ? "1" : "0",
    MOCK_REQUIRE_SUDO: options.sudoGcloudFail ? "1" : "0",
    MOCK_SUDO_GCLOUD_FAIL: options.sudoGcloudFail ? "1" : "0",
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
  const commands = () => readFile(join(state, "commands"), "utf8");
  return { run, containers, commands, cleanup: () => rm(dir, { recursive: true, force: true }) };
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
      expect(await test.commands()).toContain("image rm old-image");
      expect(await test.commands()).toContain("image prune -f");
    } finally { await test.cleanup(); }
  });

  it("keeps a running legacy primary when a stale backup exists", async () => {
    const test = await scenario({ oldHealth: "none", backup: true, schemaFail: true });
    try {
      expect((await test.run()).code).not.toBe(0);
      expect(await test.containers()).toEqual({ "snipsik-bot": "old-image|true|none" });
      expect(await test.commands()).not.toContain("start snipsik-bot");
    } finally { await test.cleanup(); }
  });

  it("does not stop the active primary when a stale backup cannot be removed", async () => {
    const test = await scenario({ backup: true, failBackupRemove: true });
    try {
      expect((await test.run()).code).not.toBe(0);
      expect(await test.containers()).toEqual({
        "snipsik-bot": "old-image|true|healthy",
        "snipsik-bot-backup": "stale-image|false|healthy",
      });
      expect(await test.commands()).not.toContain("stop snipsik-bot");
    } finally { await test.cleanup(); }
  });

  it("uses existing Docker credentials when root gcloud configuration fails", async () => {
    const test = await scenario({ sudoGcloudFail: true });
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

  it("rejects a candidate image with no health check", async () => {
    const test = await scenario({ newHealth: "none" });
    try {
      expect((await test.run()).code).not.toBe(0);
      expect(await test.containers()).toEqual({ "snipsik-bot": "old-image|true|healthy" });
    } finally { await test.cleanup(); }
  });

  it("does not start the candidate if restoring the backup fails", async () => {
    const test = await scenario({ newHealth: "unhealthy", failRestoreRename: true });
    try {
      expect((await test.run()).code).not.toBe(0);
      expect(await test.containers()).toEqual({ "snipsik-bot-backup": "old-image|false|healthy" });
      const commands = await test.commands();
      expect(commands).toContain("rename snipsik-bot-backup snipsik-bot");
      expect(commands.split("\n").filter((command) => command === "start snipsik-bot")).toHaveLength(1);
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
