'use strict';

const path = require('path');
const { access } = require('fs/promises');

const FETCH_TIMEOUT_MS = 10_000;

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

/*
 * Resolve a Strapi upload URL/path to something Sharp can consume.
 *
 * Returns either:
 *   - a local filesystem path (string) when the asset lives on disk
 *   - a Buffer when the asset must be fetched from a remote provider (S3,
 *     Cloudinary, etc.)
 *
 * Returns null if the asset cannot be located.
 */
async function resolveSource(urlOrPath, strapi) {
  if (!urlOrPath) return null;

  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`Source fetch failed (${res.status}): ${urlOrPath}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Relative URL — local provider. Strapi serves /uploads/foo.jpg from
  // strapi.dirs.static.public/uploads/foo.jpg.
  const rel = urlOrPath.startsWith('/') ? urlOrPath.slice(1) : urlOrPath;
  const localPath = path.join(strapi.dirs.static.public, rel);
  if (await fileExists(localPath)) return localPath;
  return null;
}

module.exports = { resolveSource, fileExists };
