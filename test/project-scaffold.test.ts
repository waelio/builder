import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REQUIRED_PROJECT_FILES, scaffoldProject, sanitizeProjectName } from '../src/project-scaffold';

test('sanitizeProjectName keeps supported characters', () => {
  assert.equal(sanitizeProjectName('  My Project 01!  '), 'my-project-01');
});

test('scaffoldProject creates TypeScript-ready project with required files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-test-'));
  const projectsDir = path.join(tempRoot, 'projects');

  const projectDir = scaffoldProject(projectsDir, 'Web Portal');

  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'index.ts')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'tsconfig.json')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'gent.md')), true);

  for (const fileName of REQUIRED_PROJECT_FILES) {
    assert.equal(fs.existsSync(path.join(projectDir, fileName)), true);
  }
});
