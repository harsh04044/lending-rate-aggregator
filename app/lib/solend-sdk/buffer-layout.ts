import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import BufferLayout from "buffer-layout";

/**
 * Layout for a public key
 */
export const publicKey = (property = "publicKey"): unknown => {
  const publicKeyLayout = BufferLayout.blob(32, property);

  const _decode = publicKeyLayout.decode.bind(publicKeyLayout);
  const _encode = publicKeyLayout.encode.bind(publicKeyLayout);

  publicKeyLayout.decode = (buffer: Buffer, offset: number) => {
    const data = _decode(buffer, offset);
    return new PublicKey(data);
  };

  publicKeyLayout.encode = (key: PublicKey, buffer: Buffer, offset: number) =>
    _encode(key.toBuffer(), buffer, offset);

  return publicKeyLayout;
};

/**
 * Layout for a 64bit unsigned value
 */
export const uint64 = (property = "uint64"): unknown => {
  const layout = BufferLayout.blob(8, property);

  const _decode = layout.decode.bind(layout);
  const _encode = layout.encode.bind(layout);

  layout.decode = (buffer: Buffer, offset: number) => {
    const data = _decode(buffer, offset);
    return new BN(
      [...data]
        .reverse()
        .map((i: number) => `00${i.toString(16)}`.slice(-2))
        .join(""),
      16,
    );
  };

  layout.encode = (num: BN, buffer: Buffer, offset: number) => {
    const a = num.toArray().reverse();
    let b = Buffer.from(a);
    if (b.length !== 8) {
      const zeroPad = Buffer.alloc(8);
      b.copy(zeroPad);
      b = zeroPad;
    }
    return _encode(b, buffer, offset);
  };

  return layout;
};

/**
 * Layout for a 64bit signed value
 */
export const int64 = (property = "int64"): unknown => {
  const layout = BufferLayout.blob(8, property);

  const _decode = layout.decode.bind(layout);
  const _encode = layout.encode.bind(layout);

  layout.decode = (buffer: Buffer, offset: number) => {
    const data = _decode(buffer, offset);
    const isNegative = data[7] & 0x80;
    if (isNegative) {
      const invertedData = Buffer.from(data.map((byte: number) => byte ^ 0xff));
      const negated = new BN(
        Array.from(invertedData)
          .reverse()
          .map((i: number) => `00${i.toString(16)}`.slice(-2))
          .join(""),
        16,
      ).addn(1);
      return negated.neg();
    } else {
      return new BN(
        [...data]
          .reverse()
          .map((i: number) => `00${i.toString(16)}`.slice(-2))
          .join(""),
        16,
      );
    }
  };

  layout.encode = (num: BN, buffer: Buffer, offset: number) => {
    if (num.isNeg()) {
      const absNum = num.abs();
      let a: number[] = absNum.subn(1).toArray().reverse();
      a = a.map((byte) => byte ^ 0xff);
      let b = Buffer.from(a);
      if (b.length !== 8) {
        const zeroPad = Buffer.alloc(8, 0xff);
        b.copy(zeroPad);
        b = zeroPad;
      }
      return _encode(b, buffer, offset);
    } else {
      const a = num.toArray().reverse();
      let b = Buffer.from(a);
      if (b.length !== 8) {
        const zeroPad = Buffer.alloc(8);
        b.copy(zeroPad);
        b = zeroPad;
      }
      return _encode(b, buffer, offset);
    }
  };

  return layout;
};

/**
 * Layout for a 128bit unsigned value
 */
export const uint128 = (property = "uint128"): unknown => {
  const layout = BufferLayout.blob(16, property);

  const _decode = layout.decode.bind(layout);
  const _encode = layout.encode.bind(layout);

  layout.decode = (buffer: Buffer, offset: number) => {
    const data = _decode(buffer, offset);
    return new BN(
      [...data]
        .reverse()
        .map((i: number) => `00${i.toString(16)}`.slice(-2))
        .join(""),
      16,
    );
  };

  layout.encode = (num: BN, buffer: Buffer, offset: number) => {
    const a = num.toArray().reverse();
    let b = Buffer.from(a);
    if (b.length !== 16) {
      const zeroPad = Buffer.alloc(16);
      b.copy(zeroPad);
      b = zeroPad;
    }
    return _encode(b, buffer, offset);
  };

  return layout;
};
