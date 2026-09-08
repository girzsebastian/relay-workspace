// Small, deterministic application mark; no runtime image downloads.
const zlib = require("node:zlib");
function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8);
  return out;
}
function icon(size = 64) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      const x = (col * 64) / size,
        y = (row * 64) / size;
      const p = row * (size * 4 + 1) + 1 + col * 4;
      const inside = x > 3 && x < 60 && y > 3 && y < 60;
      const mark =
        (x >= 18 && x <= 25 && y >= 17 && y <= 47) ||
        (y >= 17 && y <= 24 && x >= 18 && x <= 44) ||
        (y >= 30 && y <= 37 && x >= 18 && x <= 40) ||
        (x >= 38 && x <= 45 && y >= 20 && y <= 34) ||
        (x - y >= -5 && x - y <= 3 && y >= 34 && y <= 47);
      pixels[p] = mark ? 237 : 35;
      pixels[p + 1] = mark ? 245 : 78;
      pixels[p + 2] = mark ? 233 : 64;
      pixels[p + 3] = inside ? 255 : 0;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
module.exports = { icon };
