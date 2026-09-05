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
    let val = parsed[key];
    // Docker --env-file requires single-line entries per key
    val = val.replace(/\r\n|\r|\n/g, "\\n");
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
