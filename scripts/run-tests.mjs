#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const testRoot = '.test-dist';

const findTestFiles = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findTestFiles(path));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(path);
    }
  }

  return files;
};

const testFiles = (await findTestFiles(testRoot)).sort();

if (testFiles.length === 0) {
  throw new Error(`No compiled test files found in ${testRoot}`);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
