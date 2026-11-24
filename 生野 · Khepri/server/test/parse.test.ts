import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseBmffFile } from "../src/parseBmff.js";
import { parseImage } from "../src/parseImage.js";
import { solidPng } from "../src/png.js";

test("png header keeps the pixel size", () => {
  const image = parseImage(solidPng(960, 540, 196, 90, 40));
  assert.ok(image);
  assert.equal(image.width, 960);
  assert.equal(image.height, 540);
  assert.equal(image.rotationDegrees, 0);
  assert.equal(image.contentType, "image/png");
});

test("jpeg orientation 6 is a quarter turn", () => {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(exif.length + 2, 0);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x00, 0x00]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, exif, sof]);
  const image = parseImage(jpeg);
  assert.ok(image);
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.equal(image.rotationDegrees, 90);
});

test("bmff reader reports codec, size, and sampled timestamps", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "khepri-bmff-")), "clip.mp4");
  await writeFile(file, sampleMp4(0));
  const info = await parseBmffFile(file);
  assert.ok(info);
  assert.equal(info.container, "isom");
  assert.equal(info.videoCodec, "h264");
  assert.equal(info.width, 320);
  assert.equal(info.height, 180);
  assert.equal(info.rotationDegrees, 0);
  assert.equal(info.durationSeconds, 1);
  assert.equal(info.frameRate, 30);
  assert.equal(info.frameCount, 30);
  assert.equal(info.frameTimestamps.length, 24);
  assert.equal(info.frameTimestamps[0], 0);
  assert.equal(info.truncatedTimestamps, true);
  assert.equal(info.variableFrameRate, false);
});

test("bmff matrix of a quarter turn is 90 degrees", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "khepri-bmff-")), "turn.mp4");
  await writeFile(file, sampleMp4(90));
  const info = await parseBmffFile(file);
  assert.ok(info);
  assert.equal(info.rotationDegrees, 90);
});

function sampleMp4(rotation: 0 | 90): Buffer {
  const ftyp = box("ftyp", Buffer.concat([
    Buffer.from("isom"),
    Buffer.alloc(4),
    Buffer.from("isomavc1"),
  ]));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(1000, 16);
  const tkhd = Buffer.alloc(84);
  if (rotation === 90) tkhd.writeInt32BE(0x00010000, 44);
  else tkhd.writeInt32BE(0x00010000, 40);
  tkhd.writeInt32BE(0x00010000, rotation === 90 ? 72 : 56);
  if (rotation === 0) tkhd.writeInt32BE(0x00010000, 72);
  tkhd.writeUInt32BE(320 * 65536, 76);
  tkhd.writeUInt32BE(180 * 65536, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(30, 12);
  mdhd.writeUInt32BE(30, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, "ascii");
  const avc1 = box("avc1", Buffer.alloc(8));
  const stsdBody = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), avc1]);
  const stts = Buffer.alloc(16);
  stts.writeUInt32BE(1, 4);
  stts.writeUInt32BE(30, 8);
  stts.writeUInt32BE(1, 12);
  const stbl = box("stbl", Buffer.concat([box("stsd", stsdBody), box("stts", stts)]));
  const minf = box("minf", stbl);
  const mdia = box("mdia", Buffer.concat([box("mdhd", mdhd), box("hdlr", hdlr), minf]));
  const trak = box("trak", Buffer.concat([box("tkhd", tkhd), mdia]));
  const moov = box("moov", Buffer.concat([box("mvhd", mvhd), trak]));
  return Buffer.concat([ftyp, moov, box("mdat", Buffer.from("test"))]);
}

function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, "ascii");
  return Buffer.concat([head, payload]);
}
