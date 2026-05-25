import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function parsePng(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("unsupported-png-signature");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("truncated-png-chunk");
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (!width || !height) throw new Error("missing-ihdr");
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported-png-format bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  if (idatChunks.length === 0) throw new Error("missing-idat");

  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expectedMin = height * (rowBytes + 1);
  if (inflated.length < expectedMin) throw new Error("truncated-png-data");

  const rows = new Uint8Array(width * height * channels);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const rowOffset = y * rowBytes;
    const prevRowOffset = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= channels ? rows[rowOffset + x - channels] : 0;
      const up = y > 0 ? rows[prevRowOffset + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[prevRowOffset + x - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
      else throw new Error(`unsupported-png-filter ${filter}`);
      rows[rowOffset + x] = value & 0xff;
    }
    inputOffset += rowBytes;
  }

  return { width, height, channels, rows };
}

function colorKey(r, g, b) {
  return `${r >> 3},${g >> 3},${b >> 3}`;
}

function colorDistance(left, right) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildMetrics(image) {
  const { width, height, channels, rows } = image;
  const histogram = new Map();
  const colors = new Set();

  for (let index = 0; index < width * height; index += 1) {
    const base = index * channels;
    const r = rows[base];
    const g = rows[base + 1];
    const b = rows[base + 2];
    const a = channels === 4 ? rows[base + 3] : 255;
    if (a < 16) continue;
    const key = colorKey(r, g, b);
    colors.add(key);
    const bucket = histogram.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    histogram.set(key, bucket);
  }

  let dominant = null;
  for (const bucket of histogram.values()) {
    if (!dominant || bucket.count > dominant.count) dominant = bucket;
  }
  if (!dominant) {
    return { colorCount: 0, shapeRegions: 0, hudOccupancy: 0, centerActivity: 0 };
  }

  const background = {
    r: dominant.r / dominant.count,
    g: dominant.g / dominant.count,
    b: dominant.b / dominant.count,
  };
  const mask = new Uint8Array(width * height);
  let hudPixels = 0;
  let hudMaskPixels = 0;
  let centerPixels = 0;
  let centerMaskPixels = 0;
  const hudEdgeHeight = Math.max(1, Math.floor(height * 0.1));
  const centerLeft = Math.floor(width * 0.25);
  const centerRight = Math.ceil(width * 0.75);
  const centerTop = Math.floor(height * 0.25);
  const centerBottom = Math.ceil(height * 0.75);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const base = index * channels;
      const alpha = channels === 4 ? rows[base + 3] : 255;
      const foreground =
        alpha >= 16 &&
        colorDistance({ r: rows[base], g: rows[base + 1], b: rows[base + 2] }, background) > 28;
      if (foreground) mask[index] = 1;

      if (y < hudEdgeHeight || y >= height - hudEdgeHeight) {
        hudPixels += 1;
        if (foreground) hudMaskPixels += 1;
      }
      if (x >= centerLeft && x < centerRight && y >= centerTop && y < centerBottom) {
        centerPixels += 1;
        if (foreground) centerMaskPixels += 1;
      }
    }
  }

  const minRegionArea = Math.max(16, Math.floor(width * height * 0.0002));
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let shapeRegions = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      area += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || !mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }

    if (area >= minRegionArea) shapeRegions += 1;
  }

  return {
    colorCount: colors.size,
    shapeRegions,
    hudOccupancy: hudPixels > 0 ? hudMaskPixels / hudPixels : 0,
    centerActivity: centerPixels > 0 ? centerMaskPixels / centerPixels : 0,
  };
}

export async function computeVisualWarn(caseDir) {
  try {
    const screenshotPath = join(caseDir, "eval/screenshots/final.png");
    if (!existsSync(screenshotPath)) return { available: false, reason: "missing-final-png" };

    const image = parsePng(readFileSync(screenshotPath));
    const metrics = buildMetrics(image);
    const warnings = [];
    if (metrics.colorCount < 5) warnings.push("colorCount-low");
    if (metrics.shapeRegions < 8) warnings.push("shapeRegions-low");
    if (metrics.hudOccupancy < 0.05) warnings.push("hud-empty");
    if (metrics.centerActivity < 0.1) warnings.push("center-static");
    return { available: true, ...metrics, warnings };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
