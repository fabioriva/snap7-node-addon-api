'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S7Client, Area, WordLen, errorText } = require('..');

test('exports the essential Snap7 constants', () => {
  assert.equal(Area.DB, 0x84);
  assert.equal(WordLen.Byte, 0x02);
  assert.equal(WordLen.Real, 0x08);
});

test('constructs a disconnected client', () => {
  const client = new S7Client();
  assert.equal(client.connected, false);
});

test('rejects invalid method arguments', async () => {
  const client = new S7Client();
  await assert.rejects(client.dbRead(1, 0, 0), RangeError);
  await assert.rejects(
    client.writeArea(Area.DB, 1, 0, WordLen.Word, Buffer.alloc(3)),
    RangeError
  );
});

test('disconnect is asynchronous and idempotent for a fresh client', async () => {
  const client = new S7Client();
  await client.disconnect();
  await client.disconnect();
  assert.equal(client.connected, false);
});

test('formats Snap7 error codes', () => {
  assert.match(errorText(0), /OK|No error/i);
});

test('reports native Snap7 failures as typed Promise rejections', async () => {
  const client = new S7Client();
  await assert.rejects(client.dbRead(1, 0, 1), (error) => {
    assert.equal(error.name, 'Snap7Error');
    assert.equal(typeof error.code, 'number');
    assert.ok(error.message.length > 0);
    return true;
  });
});

test('rejects arguments outside the S7 address and transport ranges', async () => {
  const client = new S7Client();
  await assert.rejects(client.connectTo('127.1'), RangeError);
  await assert.rejects(client.connectTo('127.0.0.1\0x'), RangeError);
  await assert.rejects(client.connectTo('127.0.0.1', 8, 0), RangeError);
  await assert.rejects(client.connectTo('127.0.0.1', 0, 32), RangeError);
  await assert.rejects(client.dbRead(65536, 0, 1), RangeError);
  await assert.rejects(client.dbRead(1, 0x1fffff, 2), RangeError);
  await assert.rejects(client.readArea(Area.DB + 256, 1, 0, 1), RangeError);
  await assert.rejects(client.readArea(Area.CT, 0, 0, 1), RangeError);
  await assert.rejects(client.readArea(Area.DB, 1, 0, 2, WordLen.Bit), RangeError);
  await assert.rejects(client.writeArea(Area.DB, 1, 0, WordLen.Bit, Buffer.of(2)), RangeError);
});

test('rejects empty, shared, and oversized write views before queueing', async () => {
  const client = new S7Client();
  await assert.rejects(client.dbWrite(1, 0, new Uint8Array()), RangeError);
  await assert.rejects(client.dbWrite(1, 0, new Uint16Array(1)), TypeError);
  await assert.rejects(client.dbWrite(1, 0, new Uint8Array(new SharedArrayBuffer(1))), TypeError);
  await assert.rejects(client.dbWrite(1, 0, new Uint8Array(2 * 1024 * 1024 + 1)), RangeError);
});

test('bounds the queue and continues draining after errors', async () => {
  const client = new S7Client();
  const queued = [assert.rejects(client.dbRead(1, 0, 1), { name: 'Snap7Error' })];
  for (let i = 1; i < 32; i++) queued.push(client.disconnect());
  await assert.rejects(client.disconnect(), { code: 'ERR_SNAP7_QUEUE_FULL' });
  await Promise.all(queued);
  await client.disconnect();
});

test('reports the acknowledged byte count when a write is refused', async () => {
  const client = new S7Client();
  await assert.rejects(client.dbWrite(1, 0, Buffer.of(1)), {
    name: 'Snap7Error',
    bytesWritten: 0
  });
});
