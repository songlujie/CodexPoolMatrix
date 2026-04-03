import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLATFORMS_FILE = path.resolve(__dirname, '..', 'platforms.json');

export const DEFAULT_PLATFORMS = ['gpt', 'gemini'];

function serializePlatforms(platforms) {
  return JSON.stringify(platforms).replace(/","/g, '", "');
}

export async function listPlatforms() {
  try {
    const data = await fs.readFile(PLATFORMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [...DEFAULT_PLATFORMS];
  }
}

export async function addPlatform(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    const error = new Error('平台名称不能为空');
    error.status = 400;
    throw error;
  }

  const clean = name.trim().toLowerCase();
  const platforms = await listPlatforms();

  if (platforms.includes(clean)) {
    const error = new Error('平台已存在');
    error.status = 409;
    throw error;
  }

  platforms.push(clean);
  await fs.writeFile(PLATFORMS_FILE, serializePlatforms(platforms), 'utf8');
  return platforms;
}

export async function removePlatform(name) {
  const platforms = await listPlatforms();
  const index = platforms.indexOf(name);

  if (index === -1) {
    const error = new Error('平台不存在');
    error.status = 404;
    throw error;
  }

  platforms.splice(index, 1);
  await fs.writeFile(PLATFORMS_FILE, serializePlatforms(platforms), 'utf8');
  return platforms;
}
