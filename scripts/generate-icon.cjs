const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height) {
  // RGBA buffer
  const rgba = Buffer.alloc(width * height * 4);

  const cx = width / 2;
  const cy = height / 2;
  const rOuter = width * 0.44;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background rounded squircle / circle
      if (dist <= rOuter) {
        // Morandi dark slate background #1E2023 with subtle gradient
        const grad = (y / height) * 20;
        let r = 0x22 + Math.floor(grad);
        let g = 0x25 + Math.floor(grad);
        let b = 0x28 + Math.floor(grad);

        // Border ring in #B89882 (Morandi Terracotta)
        if (dist > rOuter - 8 && dist <= rOuter) {
          const alphaFactor = Math.min(1, (rOuter - dist) / 2);
          r = Math.floor(r * (1 - alphaFactor) + 0xb8 * alphaFactor);
          g = Math.floor(g * (1 - alphaFactor) + 0x98 * alphaFactor);
          b = Math.floor(b * (1 - alphaFactor) + 0x82 * alphaFactor);
        }

        // Draw "Synapse" neural node icon inside
        // 3 connected nodes: top-center, bottom-left, bottom-right
        const nodes = [
          { nx: cx, ny: cy - width * 0.18, rad: width * 0.08, col: [0xdf, 0xc5, 0xb0] },
          { nx: cx - width * 0.18, ny: cy + width * 0.15, rad: width * 0.07, col: [0xb8, 0x98, 0x82] },
          { nx: cx + width * 0.18, ny: cy + width * 0.15, rad: width * 0.07, col: [0xd0, 0xb4, 0x9f] },
          { nx: cx, ny: cy + width * 0.02, rad: width * 0.05, col: [0x8b, 0xa3, 0x96] },
        ];

        // Lines connecting nodes
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const n1 = nodes[i];
            const n2 = nodes[j];
            // Distance from point to line segment
            const l2 = (n2.nx - n1.nx) ** 2 + (n2.ny - n1.ny) ** 2;
            const t = Math.max(0, Math.min(1, ((x - n1.nx) * (n2.nx - n1.nx) + (y - n1.ny) * (n2.ny - n1.ny)) / l2));
            const projX = n1.nx + t * (n2.nx - n1.nx);
            const projY = n1.ny + t * (n2.ny - n1.ny);
            const lineDist = Math.hypot(x - projX, y - projY);
            if (lineDist < 3.5) {
              const blend = (3.5 - lineDist) / 3.5;
              r = Math.floor(r * (1 - blend) + 0xd0 * blend);
              g = Math.floor(g * (1 - blend) + 0xb4 * blend);
              b = Math.floor(b * (1 - blend) + 0x9f * blend);
            }
          }
        }

        // Nodes themselves
        for (const node of nodes) {
          const nd = Math.hypot(x - node.nx, y - node.ny);
          if (nd <= node.rad) {
            r = node.col[0];
            g = node.col[1];
            b = node.col[2];
          } else if (nd <= node.rad + 2) {
            const blend = (node.rad + 2 - nd) / 2;
            r = Math.floor(r * (1 - blend) + node.col[0] * blend);
            g = Math.floor(g * (1 - blend) + node.col[1] * blend);
            b = Math.floor(b * (1 - blend) + node.col[2] * blend);
          }
        }

        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = 255;
      } else {
        // Transparent outside
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      }
    }
  }

  // Build minimal uncompressed/deflated PNG
  // Raw image data with filter byte 0 at start of each scanline
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter type: None
    rgba.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const deflated = zlib.deflateSync(rawData);

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      let byte = buf[i];
      for (let j = 0; j < 8; j++) {
        const mask = -(byte & 1);
        byte = (byte >>> 1) ^ (0xedb88320 & mask);
      }
      crc = (crc >>> 8) ^ byte;
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createIco(pngBuffer, width, height) {
  // ICO header (6 bytes)
  // ICONDIR: reserved (0), type (1 for ico), count (1)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  // ICONDIRENTRY (16 bytes)
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry[2] = 0; // color palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // image size in bytes
  entry.writeUInt32LE(22, 12); // image data offset (6 + 16 = 22)

  return Buffer.concat([header, entry, pngBuffer]);
}

const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

const png256 = createPng(256, 256);
fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);
console.log('Created build/icon.png (256x256)');

const ico256 = createIco(png256, 256, 256);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico256);
console.log('Created build/icon.ico (256x256)');
