// Clinicians who asked to be removed. Only a hash of each person's key is kept
// (the repo is public; a list of names would defeat the point), and every
// build skips them.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(process.cwd(), 'scripts/removed.json');
export const removalHash = (key: string) => createHash('sha256').update(`trial-check:${key.toLowerCase()}`).digest('hex');

export function removedHashes(): Set<string> {
  return new Set(existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')).clinicians as string[]) : []);
}

export function addRemoved(keys: string[]) {
  const all = removedHashes();
  for (const k of keys) all.add(removalHash(k));
  writeFileSync(FILE, `${JSON.stringify({ _note: 'SHA-256 hashes of clinicians who asked to be removed. Added by scripts/remove-clinician.mts; every build skips them.', clinicians: [...all].sort() }, null, 2)}\n`);
}

/** True if this person, under any of their keys, asked to be removed. */
export const isRemoved = (hashes: Set<string>, keys: string[]) => keys.some((k) => hashes.has(removalHash(k)));
