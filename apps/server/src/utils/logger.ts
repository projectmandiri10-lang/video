import pino from "pino";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { LOGS_DIR } from "./paths.js";

mkdirSync(LOGS_DIR, { recursive: true });

const fileDestination = pino.destination({
  dest: path.join(LOGS_DIR, "app.log"),
  mkdir: true,
  sync: false
});

const prettyTransport = pino.transport({
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "yyyy-mm-dd HH:MM:ss.l"
  }
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info"
  },
  pino.multistream([
    { stream: prettyTransport },
    { stream: fileDestination }
  ])
);
