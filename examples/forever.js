"use strict";

const { S7Client } = require("..");
const { setTimeout: delay } = require("node:timers/promises");

const READ_INTERVAL_MS = 1000;
const RECONNECT_DELAY_MS = 2000;
const MEMORY_REPORT_INTERVAL_MS = 60_000;

function reportMemory() {
  const memory = process.memoryUsage();
  const mib = (bytes) => +(bytes / 1024 / 1024).toFixed(2);

  console.log("[memory MiB]", {
    timestamp: new Date().toISOString(),
    rss: mib(memory.rss),
    heapUsed: mib(memory.heapUsed),
    heapTotal: mib(memory.heapTotal),
    external: mib(memory.external),
    arrayBuffers: mib(memory.arrayBuffers),
  });
}

function reportError(context, error) {
  const code = error && error.code === undefined ? "" : ` ${error?.code ?? ""}`;
  console.error(`${context}${code}: ${error?.message ?? String(error)}`);
}

function isConnectionError(error) {
  if (error?.name !== "Snap7Error" || !Number.isInteger(error.code))
    return false;

  // Snap7 encodes TCP errors in the low 16 bits and ISO errors in bits 16-19.
  const tcpError = error.code & 0x0000ffff;
  const isoError = error.code & 0x000f0000;
  return (
    tcpError !== 0 ||
    [0x00010000, 0x00020000, 0x00090000, 0x000a0000].includes(isoError) ||
    error.code === 0x02000000
  ); // errCliJobTimeout
}

async function disconnectClient(client) {
  try {
    if (client.connected) {
      console.log("Disconnecting...");
      await client.disconnect();
    }
  } catch (error) {
    reportError("Snap7 disconnect error", error);
    process.exitCode = 1;
  }
}

async function main() {
  const client = new S7Client();
  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const memoryTimer = setInterval(reportMemory, MEMORY_REPORT_INTERVAL_MS);
  memoryTimer.unref();

  try {
    reportMemory();

    while (!stopping) {
      try {
        console.log("Connecting to PLC...");
        await client.connectTo(process.env.PLC_HOST ?? "192.168.20.55", 0, 1);
        if (!stopping) console.log("PLC connected.");

        while (!stopping) {
          await delay(READ_INTERVAL_MS);
          if (stopping) break;

          const data = await client.dbRead(1001, 28, 20);
          if (process.env.DEBUG_SNAP7 === "1") {
            console.log("[dbRead]", data);
          }
        }
      } catch (error) {
        if (!isConnectionError(error)) throw error;
        reportError("Snap7 connection error", error);
      } finally {
        await disconnectClient(client);
      }

      if (!stopping) {
        console.log(`Reconnecting in ${RECONNECT_DELAY_MS / 1000} seconds...`);
        await delay(RECONNECT_DELAY_MS);
      }
    }
  } finally {
    await disconnectClient(client);
    clearInterval(memoryTimer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

main().catch((error) => {
  reportError("Snap7 error", error);
  process.exitCode = 1;
});
