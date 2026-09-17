'use strict';

const { S7Client } = require('..');

async function main() {
  const client = new S7Client();

  try {
    await client.connectTo(process.env.PLC_HOST ?? '192.168.20.55', 0, 1);
    const data = await client.dbRead(1001, 28, 20);
    console.log(data);
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`Snap7 error ${error.code}: ${error.message}`);
  process.exitCode = 1;
});
