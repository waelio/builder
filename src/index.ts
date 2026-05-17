import http from 'node:http';
import path from 'node:path';
import { scaffoldFromBlueprint } from './project-scaffold';

type BlueprintPayload = {
  projects?: Array<{ name?: string }>;
};

const projectsDir = path.resolve(__dirname, '..', '..', 'projects');

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/blueprints') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}') as BlueprintPayload;
      const projectNames = (payload.projects ?? [])
        .map((project) => project.name?.trim())
        .filter((name): name is string => Boolean(name));

      if (projectNames.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No projects provided' }));
        return;
      }

      const created = scaffoldFromBlueprint(projectsDir, projectNames);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Blueprint accepted', projects: created }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
    }
  });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port);
}

export { server };
