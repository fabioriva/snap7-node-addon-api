'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const net = require('node:net');
const { S7Client, Area, WordLen } = require('..');

const pduSize = 240;
const db = Buffer.alloc(1024);

function tpkt(body) {
  const header = Buffer.from([3, 0, 0, 0]);
  header.writeUInt16BE(header.length + body.length, 2);
  return Buffer.concat([header, body]);
}

function reply(socket, request, parameters, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(12);
  header.set([0x32, 3]);
  request.copy(header, 4, 4, 6);
  header.writeUInt16BE(parameters.length, 6);
  header.writeUInt16BE(data.length, 8);
  socket.write(tpkt(Buffer.concat([Buffer.from([2, 0xf0, 0x80]), header, parameters, data])));
}

function handleRequest(socket, frame) {
  if (frame[5] === 0xe0) {
    const confirmation = Buffer.from(frame.subarray(4));
    confirmation[1] = 0xd0;
    frame.copy(confirmation, 2, 8, 10);
    socket.write(tpkt(confirmation));
    return;
  }

  const request = frame.subarray(7);
  const fn = request[10];
  if (fn === 0xf0) {
    const parameters = Buffer.from(request.subarray(10));
    parameters.writeUInt16BE(pduSize, 6);
    reply(socket, request, parameters);
    return;
  }

  assert.ok(fn === 4 || fn === 5);
  assert.equal(request[18], 0);
  assert.equal(request[19], 1);
  assert.equal(request[20], Area.DB);
  const wordSize = request[15] === WordLen.Word ? 2 : 1;
  const length = request.readUInt16BE(16) * wordSize;
  const start = request.readUIntBE(21, 3) / 8;
  if (start + length > db.length) {
    assert.equal(fn, 5);
    reply(socket, request, Buffer.of(fn, 1), Buffer.of(0x05));
    return;
  }

  if (fn === 4) {
    const dataHeader = Buffer.from([0xff, 4, 0, 0]);
    dataHeader.writeUInt16BE(length * 8, 2);
    reply(socket, request, Buffer.of(fn, 1),
      Buffer.concat([dataHeader, db.subarray(start, start + length)]));
  } else {
    request.copy(db, start, 28, 28 + length);
    reply(socket, request, Buffer.of(fn, 1), Buffer.of(0xff));
  }
}

test('loopback S7 round trip with queued writes and multiple PDUs', {
  skip: process.env.SNAP7_TEST_LOOPBACK !== '1',
  timeout: 10_000
}, async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let input = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 4) {
        const size = input.readUInt16BE(2);
        assert.ok(size >= 7);
        if (input.length < size) break;
        handleRequest(socket, input.subarray(0, size));
        input = input.subarray(size);
      }
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  });
  server.listen(Number(process.env.SNAP7_TEST_PORT || 102), '127.0.0.1');
  await once(server, 'listening');

  const client = new S7Client();
  const otherClient = new S7Client();
  const source = new Uint8Array(603).subarray(2, 602);
  source.fill(0x37);
  const first = client.connectTo('127.0.0.1');
  const write = client.dbWrite(1, 13, source);
  const read = client.dbRead(1, 13, source.length);
  source.fill(0x81);
  const [, , result] = await Promise.all([first, write, read, otherClient.connectTo('127.0.0.1')]);
  assert.deepEqual(result, Buffer.alloc(600, 0x37));
  assert.equal(client.connected, true);

  const areas = Buffer.of(1, 2, 3, 4);
  const areaWrite = otherClient.writeArea(Area.DB, 1, 0, WordLen.Word, areas);
  areas.fill(0);
  await areaWrite;
  assert.deepEqual(await client.readArea(Area.DB, 1, 0, 2, WordLen.Word), Buffer.of(1, 2, 3, 4));

  const segmentBytes = pduSize - 28;
  await assert.rejects(client.dbWrite(1, 800, Buffer.alloc(430, 0x51)), {
    name: 'Snap7Error',
    bytesWritten: segmentBytes
  });
  assert.deepEqual(await client.dbRead(1, 800, segmentBytes), Buffer.alloc(segmentBytes, 0x51));

  for (const socket of sockets) socket.destroy();
  await assert.rejects(otherClient.dbRead(1, 0, 1), { name: 'Snap7Error' });
  assert.equal(otherClient.connected, false);
  await Promise.all([client.disconnect(), otherClient.disconnect()]);
  await client.connectTo('127.0.0.1');
  assert.deepEqual(await client.dbRead(1, 0, 4), Buffer.of(1, 2, 3, 4));
  await client.disconnect();
});
