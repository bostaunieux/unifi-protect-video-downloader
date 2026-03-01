/**
 * Logger that prepends ISO timestamps to all messages.
 * Drop-in replacement for console with timestamp formatting.
 * Can be passed to libraries expecting a console-like interface (e.g. decodeUpdatePacket).
 */
const timestamp = () => `[${new Date().toISOString()}] `;

function formatArgs(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first === "string") {
    return [timestamp() + first, ...rest];
  }
  return [timestamp(), ...args];
}

export const logger = {
  log: (...args: unknown[]) => console.log(...formatArgs(args)),
  info: (...args: unknown[]) => console.info(...formatArgs(args)),
  warn: (...args: unknown[]) => console.warn(...formatArgs(args)),
  error: (...args: unknown[]) => console.error(...formatArgs(args)),
  debug: (...args: unknown[]) => console.debug(...formatArgs(args)),
};
