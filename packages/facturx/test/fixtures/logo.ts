import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Logo de test : PNG RVBA 8 bits, avec de vraies zones transparentes — le cas qui exerce le masque
 * de transparence (SMask) et le contrôle PDF/A qui va avec. Fabriqué ici plutôt que versionné.
 */
export function testLogo(width = 240, height = 120): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits par composante
  header[9] = 6; // RVBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const disc = (x - height / 2) ** 2 + (y - height / 2) ** 2 < (height * 0.42) ** 2;
      const bar =
        x > width * 0.55 && x < width * 0.95 && ((y > 35 && y < 55) || (y > 70 && y < 85));
      const o = y * stride + 1 + x * 4;
      const [r, g, b, a] = disc ? [20, 30, 60, 255] : bar ? [220, 90, 40, 255] : [0, 0, 0, 0];
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}
