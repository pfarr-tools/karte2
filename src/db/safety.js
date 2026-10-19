import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function resolveExistingPath(candidate) {
  const absolutePath = path.resolve(candidate);
  const missingParts = [];
  let currentPath = absolutePath;

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Cannot resolve database path: ${candidate}`);
    }
    missingParts.unshift(path.basename(currentPath));
    currentPath = parentPath;
  }

  return path.join(fs.realpathSync.native(currentPath), ...missingParts);
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Validate a database path before any SQLite connection or destructive action.
 *
 * @param {{nodeEnv: string, databasePath: string, testRoot: string, runtimeRoot: string}} options
 * @returns {string} resolved, safe database path
 */
export function assertSafeDatabasePath({ nodeEnv, databasePath, testRoot, runtimeRoot }) {
  if (nodeEnv !== 'test') {
    throw new Error('Database safety requires NODE_ENV=test.');
  }
  if (!databasePath || !testRoot || !runtimeRoot) {
    throw new Error('Database safety requires databasePath, testRoot, and runtimeRoot.');
  }

  const resolvedDatabasePath = resolveExistingPath(databasePath);
  const resolvedTestRoot = resolveExistingPath(testRoot);
  const resolvedRuntimeRoot = resolveExistingPath(runtimeRoot);

  if (isWithin(resolvedDatabasePath, resolvedRuntimeRoot)) {
    throw new Error('Test database path must not point into runtime storage.');
  }
  if (!isWithin(resolvedDatabasePath, resolvedTestRoot)) {
    throw new Error('Test database path must be inside the dedicated test directory.');
  }

  return resolvedDatabasePath;
}

/**
 * Create a unique, not-yet-created SQLite path inside a dedicated test root.
 *
 * @param {string} testRoot
 * @returns {string}
 */
export function createTestDatabasePath(testRoot) {
  fs.mkdirSync(testRoot, { recursive: true });
  const suffix = crypto.randomBytes(12).toString('hex');
  return path.join(testRoot, `karte2-${process.pid}-${Date.now()}-${suffix}.sqlite`);
}
