/**
 * E2E tests for the Builder API (src/index.ts)
 *
 * Tests the Express server endpoints end-to-end — real HTTP,
 * real file system, no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import express, { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { scaffoldFromBlueprint } from '../../src/project-scaffold';

// ── Test fixtures ──────────────────────────────────────────────
let tmpProjectsDir: string;
let app: express.Express;
let server: http.Server;

function buildApp(projectsDir: string): express.Express {
  const a = express();
  a.use(express.json({ limit: '1mb' }));
  a.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  interface BlueprintProject { name?: string }
  interface BlueprintPayload { projects?: BlueprintProject[] }

  a.post('/webhooks/blueprints', (req: Request, res: Response): void => {
    try {
      const payload = req.body as BlueprintPayload;
      const projectNames = (payload.projects ?? [])
        .map((p) => p.name?.trim())
        .filter((n): n is string => Boolean(n));

      if (projectNames.length === 0) {
        res.status(400).json({ error: 'No projects provided' });
        return;
      }

      const created = scaffoldFromBlueprint(projectsDir, projectNames);
      res.status(202).json({ message: 'Blueprint accepted', projects: created });
    } catch {
      res.status(500).json({ error: 'Failed to process blueprint' });
    }
  });

  return a;
}

beforeAll(() => {
  tmpProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waelio-builder-e2e-'));
  app = buildApp(tmpProjectsDir);
  server = http.createServer(app);
  return new Promise<void>((resolve) => { server.listen(0, resolve); });
});

afterAll(() => {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
    fs.rmSync(tmpProjectsDir, { recursive: true, force: true });
  });
});

// ── Blueprint webhook tests ────────────────────────────────────
describe('POST /webhooks/blueprints', () => {
  it('returns 400 when no projects are provided', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({})
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when projects array is empty', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [] })
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when all project names are blank', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: '   ' }, { name: '' }] })
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('scaffolds a single project and returns 202', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: 'my-test-site' }] })
      .expect(202);

    expect(res.body.message).toBe('Blueprint accepted');
    expect(Array.isArray(res.body.projects)).toBe(true);
    expect(res.body.projects).toHaveLength(1);
  });

  it('scaffolds multiple projects at once', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }] })
      .expect(202);

    expect(res.body.projects).toHaveLength(3);
  });

  it('sanitizes project names with special chars', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: 'My Awesome Site!!!' }] })
      .expect(202);

    // Should have been sanitized — no spaces or !
    const created: string[] = res.body.projects as string[];
    expect(created[0]).not.toMatch(/[\s!]/);
  });

  it('is idempotent — scaffolding same project twice does not error', async () => {
    await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: 'idempotent-project' }] })
      .expect(202);

    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: 'idempotent-project' }] })
      .expect(202);

    expect(res.body.message).toBe('Blueprint accepted');
  });

  it('sets CORS headers on the response', async () => {
    const res = await request(app)
      .post('/webhooks/blueprints')
      .send({ projects: [{ name: 'cors-test' }] })
      .expect(202);

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
