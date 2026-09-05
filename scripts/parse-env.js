import fs from "fs";
import dotenv from "dotenv";

const raw = process.env.APP_ENV;
const targetPath = process.argv[2] || ".env.prod";

if (!raw || raw.trim().length === 0) {
  console.error(
    "Error: APP_ENV environment variable is empty or not provided!",
  );
  process.exit(1);
}

try {
  const parsed = dotenv.parse(raw);
  const keys = Object.keys(parsed);

  if (keys.length === 0) {
    console.error("Error: No valid environment variables found in APP_ENV!");
    process.exit(1);
  }

  const lines = keys.map((key) => {
    const val = parsed[key];
    // Docker --env-file requires single-line entries per key and does not support multiline values
    if (/[\r\n]/.test(val)) {
      console.error(
        `Error: Environment variable "${key}" contains newline characters. Multiline values are not supported by Docker --env-file.`,
      );
      process.exit(1);
    }
    return `${key}=${val}`;
  });

  fs.writeFileSync(targetPath, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(
    `Successfully normalized ${keys.length} environment variables with dotenv to ${targetPath}`,
  );
  console.log(`Configured keys: ${keys.join(", ")}`);
} catch (error) {
  console.error("Error parsing environment variables with dotenv:", error);
  process.exit(1);
}
