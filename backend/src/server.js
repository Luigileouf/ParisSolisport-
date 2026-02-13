import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const app = buildApp();

async function start() {
  try {
    await app.listen({
      port: config.port,
      host: "0.0.0.0"
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown() {
  try {
    await app.close();
    await pool.end();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
