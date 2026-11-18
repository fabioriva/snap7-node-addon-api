# snap7-node-addon-api

An asynchronous, Promise-based Node.js binding for the essential Snap7
`S7Client` operations. Snap7 is compiled into the native addon from vendored
source; no system-wide Snap7 installation is required.

Supported build targets:

- Linux x64 and ARM64. Linux prebuilds target Ubuntu 22.04 (glibc).
- Windows x64
- Node.js 22 or newer

## Requirements

Linux requires Python 3, `make`, and a C++17 compiler. On Debian/Ubuntu:

```sh
sudo apt install build-essential python3
```

Windows requires Python 3 and Visual Studio 2022 Build Tools with the
**Desktop development with C++** workload.

## Build and test

```sh
npm install
npm test
```

To force a clean native rebuild:

```sh
npm run clean
npm run build
```

Use `npm run build:prebuilt -- --target <node-version>` to generate a prebuild.
The loopback integration test is opt-in with `SNAP7_TEST_LOOPBACK=1`. It needs
permission to listen on `127.0.0.1:102` and uses an in-process simulator.

## Usage

```js
const { S7Client, Area, WordLen } = require('snap7-node-addon-api');

async function run() {
  const client = new S7Client();

  try {
    await client.connectTo('192.168.0.1', 0, 2);

    const input = await client.dbRead(1, 0, 16);
    console.log(input);

    await client.dbWrite(1, 4, Buffer.from([0x00, 0x2a]));

    const markers = await client.readArea(
      Area.MK,
      0,
      0,
      8,
      WordLen.Byte
    );
    console.log(markers);
  } catch (error) {
    console.error(error.code, error.message);
  } finally {
    await client.disconnect();
  }
}

run();
```

Calls made on one `S7Client` instance execute in invocation order. Native
network work runs outside the Node.js event loop. Different client instances
can operate concurrently. Each client accepts up to 32 unfinished operations,
including the one in progress. Additional calls reject with
`ERR_SNAP7_QUEUE_FULL`. Await outstanding calls before retrying.

## API

### `new S7Client()`

Creates an independent native Snap7 client.

### `client.connectTo(address, rack = 0, slot = 2)`

Connects to a PLC using an IPv4 address in dotted-decimal form and resolves with
no value. Rack must be 0–7 and slot 0–31. Rejects with a `Snap7Error` whose
numeric Snap7 code is available as `error.code`.

### `client.disconnect()`

Disconnects the client.

### `client.dbRead(dbNumber, start, size)`

Reads `size` bytes and resolves to a Node.js `Buffer`.

### `client.dbWrite(dbNumber, start, data)`

Writes a `Buffer` or `Uint8Array`. The addon snapshots the selected view when
the method is called. Views backed by a `SharedArrayBuffer` are rejected.

### `client.readArea(area, dbNumber, start, amount, wordLen)`

Reads a raw Snap7 area. The returned buffer size is `amount` multiplied by the
selected word length. Snap7 permits only one item for `WordLen.Bit`; for bits,
`start` is a bit address. For `Area.CT` and `Area.TM`, use `WordLen.Counter`
and `WordLen.Timer` respectively, and pass an element index. Other areas use a
byte offset. Pass `dbNumber = 0` outside `Area.DB` and a DB number in 0–65535
for `Area.DB`. The operation must fit the 24-bit S7 address range and is
limited to 2 MiB.

### `client.writeArea(area, dbNumber, start, wordLen, data)`

Writes a raw area using the same snapshot and range rules. The element count is
inferred from the byte length and word size. A bit write takes one byte with
value 0 or 1.

Both write methods can span multiple PDUs and are non-atomic. On a Snap7
error, `error.bytesWritten` reports the bytes acknowledged by the PLC. If a
response is lost, the last unacknowledged segment may also have been applied.

### `client.connected`

Returns the last connection state observed by the native client.

### `errorText(code)`

Formats a numeric Snap7 client error code.

## PLC notes

- S7-300/400 commonly use rack `0`, slot `2`.
- S7-1200/1500 commonly use rack `0`, slot `1`.
- PUT/GET access must be enabled in the PLC configuration where required.
- Optimized DB access may need to be disabled for absolute DB addressing.

## Licensing

The binding is MIT-licensed. The vendored Snap7 source remains under LGPL-3.0
or later. See `THIRD_PARTY_NOTICES.md` and `vendor/snap7/lgpl-3.0.txt` before
distributing binaries. The package includes the binding, build configuration,
and corresponding Snap7 source used by the release workflow. Run
`npm ci --ignore-scripts` and `npm run build` from the release checkout to
recompile with a locally modified copy under `vendor/snap7/`.
