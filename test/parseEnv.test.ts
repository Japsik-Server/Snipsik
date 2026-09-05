import { describe, expect, it } from "bun:test";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

describe("scripts/parse-env.js", () => {
  it("parses double quotes, single quotes, escapes, and inline comments using dotenv spec", () => {
    const tmpFile = path.join(os.tmpdir(), `test-parse-${Date.now()}.txt`);

    const input = `
# Comment line
DISCORD_TOKEN="bot-token$#@!"
SINK_API_TOKEN="complex$#@!\\"with\\"quotes"
SINGLE_TOKEN='raw$#@!\\"no_escape\\"'
PLAIN_TOKEN=plain_value # inline comment
DATABASE_URL="postgresql://user:pass@localhost:5432/db"
`;

    execSync(`bun run scripts/parse-env.js "${tmpFile}"`, {
      env: { ...process.env, APP_ENV: input },
    });

    const content = fs.readFileSync(tmpFile, "utf-8");
    fs.unlinkSync(tmpFile);

    const lines = content.trim().split("\n");
    expect(lines).toContain("DISCORD_TOKEN=bot-token$#@!");
    expect(lines).toContain('SINK_API_TOKEN=complex$#@!\\"with\\"quotes');
    expect(lines).toContain('SINGLE_TOKEN=raw$#@!\\"no_escape\\"');
    expect(lines).toContain("PLAIN_TOKEN=plain_value");
    expect(lines).toContain(
      "DATABASE_URL=postgresql://user:pass@localhost:5432/db",
    );
  });

  it("rejects environment variables with newline characters to preserve Docker env-file contract", () => {
    const tmpFile = path.join(os.tmpdir(), `test-parse-fail-${Date.now()}.txt`);
    const inputWithNewline = `
VALID_KEY="valid"
MULTILINE_KEY="line1\\nline2"
`;

    expect(() => {
      execSync(`bun run scripts/parse-env.js "${tmpFile}"`, {
        env: { ...process.env, APP_ENV: inputWithNewline },
        stdio: "pipe",
      });
    }).toThrow();

    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });
});
