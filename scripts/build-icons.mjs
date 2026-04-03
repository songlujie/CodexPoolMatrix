import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const ICON_SVG_PATH = path.join(BUILD_DIR, 'icon.svg');
const ICON_PNG_PATH = path.join(BUILD_DIR, 'icon.png');
const ICON_ICO_PATH = path.join(BUILD_DIR, 'icon.ico');

function renderPng(svg, size) {
  const renderer = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: size,
    },
  });

  return renderer.render().asPng();
}

function createIcoFromPng(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

async function main() {
  const svg = await readFile(ICON_SVG_PATH, 'utf8');
  const png1024 = renderPng(svg, 1024);
  const png256 = renderPng(svg, 256);

  await mkdir(BUILD_DIR, { recursive: true });
  await writeFile(ICON_PNG_PATH, png1024);
  await writeFile(ICON_ICO_PATH, createIcoFromPng(png256));
  await rm(path.join(BUILD_DIR, 'icon.icns'), { force: true });
  await rm(path.join(BUILD_DIR, 'icon.iconset'), { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
