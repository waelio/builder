import express, { Request, Response } from 'express';
import path from 'node:path';
import { scaffoldFromBlueprint } from './project-scaffold';

const repoRoot =
  process.env.WAELIO_BUILDER_ROOT ?? process.cwd();
const projectsDir = path.join(repoRoot, 'projects');

const app = express();
export const server: express.Express = app;

const port = Number(process.env.PORT || 3000);

// Serve static files for the UI
app.use(express.static(path.join(repoRoot, 'public')));

// Middleware to parse JSON payloads
app.use(express.json({ limit: '1mb' }));

interface BlueprintProject {
  name?: string;
}

interface BlueprintPayload {
  projects?: BlueprintProject[];
}

app.post('/webhooks/blueprints', (req: Request, res: Response): void => {
  try {
    const payload: BlueprintPayload = req.body;

    const projectNames = (payload.projects ?? [])
      .map((project) => project.name?.trim())
      .filter((name): name is string => Boolean(name));

    if (projectNames.length === 0) {
      res.status(400).json({ error: 'No projects provided' });
      return;
    }

    const created = scaffoldFromBlueprint(projectsDir, projectNames);
    res
      .status(202)
      .json({ message: 'Blueprint accepted', projects: created });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process blueprint' });
  }
});

let serverInstance;
if (require.main === module) {
  serverInstance = app.listen(port, () => {
    console.log(
      `Builder webhook and UI listening on http://localhost:${port}`
    );
  });
}
