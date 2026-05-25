/**
 * E2E tests for project-scaffold.ts
 *
 * Tests the scaffolding logic against a real temp filesystem.
 * No network, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractProjectNames,
  sanitizeProjectName,
  scaffoldProject,
  scaffoldFromBlueprint,
  REQUIRED_PROJECT_FILES,
  WAELIO_CLI_TOOLS,
} from '../../src/project-scaffold';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waelio-scaffold-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── sanitizeProjectName ────────────────────────────────────────
describe('sanitizeProjectName', () => {
  it('lowercases the input', () => {
    expect(sanitizeProjectName('MyProject')).toBe('myproject');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeProjectName('my project name')).toBe('my-project-name');
  });

  it('strips leading and trailing hyphens', () => {
    expect(sanitizeProjectName('--my-project--')).toBe('my-project');
  });

  it('replaces special characters', () => {
    expect(sanitizeProjectName('my@project!site')).toBe('my-project-site');
  });

  it('collapses multiple special chars into one hyphen', () => {
    expect(sanitizeProjectName('my!!!project')).toBe('my-project');
  });

  it('falls back to "project" for an empty input', () => {
    expect(sanitizeProjectName('')).toBe('project');
  });

  it('falls back to "project" for whitespace-only input', () => {
    expect(sanitizeProjectName('   ')).toBe('project');
  });

  it('preserves hyphens and underscores', () => {
    expect(sanitizeProjectName('my-project_v2')).toBe('my-project_v2');
  });

  it('preserves numbers', () => {
    expect(sanitizeProjectName('project42')).toBe('project42');
  });
});

// ── extractProjectNames ─────────────────────────────────────────
describe('extractProjectNames', () => {
  it('reads project names from the existing blueprint projects array', () => {
    const names = extractProjectNames({
      projects: [{ name: 'Alpha' }, { name: '  Beta  ' }, { name: '' }],
    });

    expect(names).toEqual(['Alpha', 'Beta']);
  });

  it('reads a Siteforge site_name payload when projects are omitted', () => {
    const names = extractProjectNames({
      site_name: 'Siteforge Landing Page',
    });

    expect(names).toEqual(['Siteforge Landing Page']);
  });

  it('falls back to nested Siteforge site metadata', () => {
    const names = extractProjectNames({
      site: { name: 'Nested Siteforge Site' },
    });

    expect(names).toEqual(['Nested Siteforge Site']);
  });

  it('prefers explicit Siteforge names over domain fallback values', () => {
    const names = extractProjectNames({
      site_name: 'Siteforge Display Name',
      site: { domain: 'display-name.siteforge.test' },
    });

    expect(names).toEqual(['Siteforge Display Name']);
  });

  it('returns an empty list when no usable name exists', () => {
    const names = extractProjectNames({
      projects: [{ name: '   ' }],
      site_name: '   ',
      site: { name: '' },
    });

    expect(names).toEqual([]);
  });
});

// ── scaffoldProject ────────────────────────────────────────────
describe('scaffoldProject', () => {
  it('creates the projects directory if it does not exist', () => {
    const projectsDir = path.join(tmpDir, 'non-existent', 'projects');
    scaffoldProject(projectsDir, 'new-site');
    expect(fs.existsSync(projectsDir)).toBe(true);
  });

  it('returns the absolute path to the new project directory', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const result = scaffoldProject(projectsDir, 'my-site');
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toContain('my-site');
  });

  it('creates a gent.md file inside the project', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const projectDir = scaffoldProject(projectsDir, 'test-project');
    expect(fs.existsSync(path.join(projectDir, 'gent.md'))).toBe(true);
  });

  it('gent.md contains the sanitized project name', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const projectDir = scaffoldProject(projectsDir, 'Test Project');
    const content = fs.readFileSync(path.join(projectDir, 'gent.md'), 'utf8');
    expect(content).toContain('test-project');
  });

  it('creates waelio.tools.json with correct shape', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const projectDir = scaffoldProject(projectsDir, 'tools-test');
    const toolsPath = path.join(projectDir, 'waelio.tools.json');
    expect(fs.existsSync(toolsPath)).toBe(true);

    const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8')) as typeof WAELIO_CLI_TOOLS;
    expect(tools.source).toBe('@waelio/cli');
    expect(Array.isArray(tools.localTools)).toBe(true);
    expect(Array.isArray(tools.externalTools)).toBe(true);
  });

  it('creates all required project files', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const projectDir = scaffoldProject(projectsDir, 'full-project');

    for (const requiredFile of REQUIRED_PROJECT_FILES) {
      expect(
        fs.existsSync(path.join(projectDir, requiredFile)),
        `Missing required file: ${requiredFile}`
      ).toBe(true);
    }
  });

  it('does not overwrite an existing project directory', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const projectDir = scaffoldProject(projectsDir, 'existing-project');

    // Write a sentinel file
    const sentinel = path.join(projectDir, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'do-not-delete', 'utf8');

    // Scaffold again
    scaffoldProject(projectsDir, 'existing-project');

    // Sentinel must still be there
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('do-not-delete');
  });

  it('sanitizes the project name before creating the directory', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const projectDir = scaffoldProject(projectsDir, 'My New Site!!!');
    expect(path.basename(projectDir)).toBe('my-new-site');
  });
});

// ── scaffoldFromBlueprint ──────────────────────────────────────
describe('scaffoldFromBlueprint', () => {
  it('scaffolds multiple projects and returns all paths', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const names = ['site-a', 'site-b', 'site-c'];
    const results = scaffoldFromBlueprint(projectsDir, names);

    expect(results).toHaveLength(3);
    for (const dir of results) {
      expect(fs.existsSync(dir)).toBe(true);
    }
  });

  it('returns an empty array for an empty input', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const results = scaffoldFromBlueprint(projectsDir, []);
    expect(results).toHaveLength(0);
  });

  it('each returned path is an absolute path', () => {
    const projectsDir = path.join(tmpDir, 'projects');
    const results = scaffoldFromBlueprint(projectsDir, ['abs-test']);
    expect(path.isAbsolute(results[0])).toBe(true);
  });
});
