'use strict';

const { types } = require('node:util');
const binding = require('node-gyp-build')(__dirname);

const maxPendingOperations = 32;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;

function snapshotBytes(data) {
  if (!types.isUint8Array(data)) {
    throw new TypeError('data must be a Buffer or Uint8Array');
  }
  const buffer = arrayBuffer.call(data);
  if (types.isSharedArrayBuffer(buffer)) {
    throw new TypeError('data must use an ArrayBuffer');
  }
  const length = byteLength.call(data);
  if (length === 0 || length > binding.maxTransferBytes) {
    throw new RangeError('data length is out of range');
  }
  return Buffer.from(new Uint8Array(buffer, byteOffset.call(data), length));
}

class S7Client {
  #native;
  #tail = Promise.resolve();
  #pending = 0;

  constructor() {
    this.#native = new binding.NativeS7Client();
  }

  get connected() {
    return this.#native.connected;
  }

  #enqueue(operation, prepare) {
    if (this.#pending >= maxPendingOperations) {
      const error = new Error('S7Client operation queue is full');
      error.code = 'ERR_SNAP7_QUEUE_FULL';
      return Promise.reject(error);
    }
    let input;
    try {
      input = prepare?.();
    } catch (error) {
      return Promise.reject(error);
    }
    this.#pending++;
    const result = this.#tail.then(() => operation(input));
    const release = () => { this.#pending--; };
    this.#tail = result.then(release, release);
    return result;
  }

  connectTo(address, rack = 0, slot = 2) {
    return this.#enqueue(() => this.#native.connectTo(address, rack, slot));
  }

  disconnect() {
    return this.#enqueue(() => this.#native.disconnect());
  }

  dbRead(dbNumber, start, size) {
    return this.#enqueue(() => this.#native.dbRead(dbNumber, start, size));
  }

  dbWrite(dbNumber, start, data) {
    return this.#enqueue(
      (bytes) => this.#native.dbWrite(dbNumber, start, bytes),
      () => snapshotBytes(data)
    );
  }

  readArea(area, dbNumber, start, amount, wordLen = binding.WordLen.Byte) {
    return this.#enqueue(() =>
      this.#native.readArea(area, dbNumber, start, amount, wordLen)
    );
  }

  writeArea(area, dbNumber, start, wordLen, data) {
    return this.#enqueue(
      (bytes) => this.#native.writeArea(area, dbNumber, start, wordLen, bytes),
      () => snapshotBytes(data)
    );
  }
}

module.exports = {
  S7Client,
  Area: Object.freeze(binding.Area),
  WordLen: Object.freeze(binding.WordLen),
  errorText: binding.errorText
};
