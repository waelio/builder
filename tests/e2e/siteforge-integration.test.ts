/**
 * E2E smoke test for Siteforge webhook compatibility.
 *
 * Uses the real Express app and an isolated template/projects root.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';

interface BlueprintResponse {
  message: string;
  projects: string[];
}

let app: express.Express;
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waelio-siteforge-'));
  fs.cpSync(
    path.join(process.cwd(), 'templates'),
    path.join(tmpRoot, 'templates'),
    { recursive: true }
  );

  vi.stubEnv('WAELIO_BUILDER_ROOT', tmpRoot);
  vi.resetModules();

  const mod = await import('../../src/index') as { server: express.Express };
  app = mod.server;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Siteforge blueprint integration', () => {
  it('accepts a Siteforge-style site payload and scaffolds a project', async () => {
    const payload = {
      source: 'siteforge',
      event: 'site.blueprint.ready',
      site_name: 'Siteforge Marketing Site',
      site: {
        domain: 'marketing.siteforge.test',
      },
    };

    const res = await request(app)
      .post('/webhooks/blueprints')
      .set('X-Siteforge-Event', 'site.blueprint.ready')
      .send(payload)
      .expect(202);

    const body = res.body as BlueprintResponse;
    const expectedProjectDir = path.join(
      tmpRoot,
      'projects',
      'siteforge-marketing-site'
    );

    expect(body.message).toBe('Blueprint accepted');
    expect(body.projects).toEqual([expectedProjectDir]);
    expect(fs.existsSync(path.join(expectedProjectDir, 'gent.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedProjectDir, 'waelio.tools.json'))).toBe(true);
    expect(fs.existsSync(path.join(expectedProjectDir, 'SEO'))).toBe(true);
  });
});
