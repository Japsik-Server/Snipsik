const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function formatTime(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.log(
      `${colors.dim}[${formatTime()}]${colors.reset} ${colors.blue}[INFO]${colors.reset} ${message}`,
      ...args
    );
  },

  success(message: string, ...args: unknown[]): void {
    console.log(
      `${colors.dim}[${formatTime()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${message}`,
      ...args
    );
  },

  warn(message: string, ...args: unknown[]): void {
    console.warn(
      `${colors.dim}[${formatTime()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${message}`,
      ...args
    );
  },

  error(message: string, error?: unknown): void {
    console.error(
      `${colors.dim}[${formatTime()}]${colors.reset} ${colors.red}[ERROR]${colors.reset} ${message}`,
      error !== undefined ? error : ""
    );
  },

  debug(message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `${colors.dim}[${formatTime()}]${colors.reset} ${colors.magenta}[DEBUG]${colors.reset} ${message}`,
        ...args
      );
    }
  },
};
