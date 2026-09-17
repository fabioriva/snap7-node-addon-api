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
