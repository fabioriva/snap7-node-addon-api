export interface Snap7Error extends Error {
  /** Numeric error returned by Snap7. */
  code: number;
}

export declare const Area: Readonly<{
  PE: 0x81;
  PA: 0x82;
  MK: 0x83;
  DB: 0x84;
  CT: 0x1c;
  TM: 0x1d;
}>;

export declare const WordLen: Readonly<{
  Bit: 0x01;
  Byte: 0x02;
  Char: 0x03;
  Word: 0x04;
  Int: 0x05;
  DWord: 0x06;
  DInt: 0x07;
  Real: 0x08;
  Counter: 0x1c;
  Timer: 0x1d;
}>;

export type AreaValue = (typeof Area)[keyof typeof Area];
export type WordLenValue = (typeof WordLen)[keyof typeof WordLen];

export declare class S7Client {
  /** Last known native connection state. */
  readonly connected: boolean;

  connectTo(address: string, rack?: number, slot?: number): Promise<void>;
  disconnect(): Promise<void>;

  dbRead(dbNumber: number, start: number, size: number): Promise<Buffer>;
  dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void>;

  readArea(
    area: AreaValue,
    dbNumber: number,
    start: number,
    amount: number,
    wordLen?: WordLenValue
  ): Promise<Buffer>;

  writeArea(
    area: AreaValue,
    dbNumber: number,
    start: number,
    wordLen: WordLenValue,
    data: Uint8Array
  ): Promise<void>;
}

export declare function errorText(code: number): string;
