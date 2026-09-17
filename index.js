'use strict';

const binding = require('node-gyp-build')(__dirname);

class S7Client {
  #native;
  #tail = Promise.resolve();

  constructor() {
    this.#native = new binding.NativeS7Client();
  }

  get connected() {
    return this.#native.connected;
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined
    );
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
    return this.#enqueue(() => this.#native.dbWrite(dbNumber, start, data));
  }

  readArea(area, dbNumber, start, amount, wordLen = binding.WordLen.Byte) {
    return this.#enqueue(() =>
      this.#native.readArea(area, dbNumber, start, amount, wordLen)
    );
  }

  writeArea(area, dbNumber, start, wordLen, data) {
    return this.#enqueue(() =>
      this.#native.writeArea(area, dbNumber, start, wordLen, data)
    );
  }
}

module.exports = {
  S7Client,
  Area: Object.freeze(binding.Area),
  WordLen: Object.freeze(binding.WordLen),
  errorText: binding.errorText
};
