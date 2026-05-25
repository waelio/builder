import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_PROJECT_FILES: string[] = [
  'ABOUT',
  'CONTACT',
  'about',
  'CASL.AUTH',
  'MONGODB',
  'ORM',
  'SEO'
];

function findRepoRoot() {
  if (process.env.WAELIO_BUILDER_ROOT) return process.env.WAELIO_BUILDER_ROOT;
  const distPath = path.resolve(__dirname, '../../templates');
  if (fs.existsSync(distPath)) return path.resolve(__dirname, '../../');
  return path.resolve(__dirname, '../');
}

const REPO_ROOT = findRepoRoot();
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'project-template');

export const WAELIO_CLI_TOOLS = {
  source: '@waelio/cli',
  localTools: ['builder', 'blueprint-webhook', 'project-template'],
  externalTools: ['casl', 'mongodb', 'orm', 'seo']
};

export interface BlueprintProject {
  name?: string | null;
  title?: string | null;
}

export interface BlueprintSite {
  name?: string | null;
  site_name?: string | null;
  domain?: string | null;
}

export interface BlueprintPayload {
  projects?: BlueprintProject[];
  project?: BlueprintProject | null;
  site?: BlueprintSite | null;
  site_name?: string | null;
  siteName?: string | null;
}

function normalizePayloadName(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function extractProjectNames(payload: BlueprintPayload): string[] {
  const projectNames = (payload.projects ?? [])
    .map((project) =>
      normalizePayloadName(project.name) ?? normalizePayloadName(project.title)
    )
    .filter((name): name is string => Boolean(name));

  if (projectNames.length > 0) {
    return projectNames;
  }

  const siteforgeName = [
    payload.project?.name,
    payload.project?.title,
    payload.site_name,
    payload.siteName,
    payload.site?.name,
    payload.site?.site_name,
    payload.site?.domain,
  ]
    .map((name) => normalizePayloadName(name))
    .find((name): name is string => Boolean(name));

  return siteforgeName ? [siteforgeName] : [];
}

export function sanitizeProjectName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

export function scaffoldProject(
  projectsDir: string,
  projectName: string
): string {
  const sanitized = sanitizeProjectName(projectName);
  const projectDir = path.join(projectsDir, sanitized);

  fs.mkdirSync(projectsDir, { recursive: true });

  if (!fs.existsSync(projectDir)) {
    fs.cpSync(TEMPLATE_DIR, projectDir, { recursive: true });
  }

  // Generate gent.md
  const gentPath = path.join(projectDir, 'gent.md');
  if (!fs.existsSync(gentPath)) {
    fs.writeFileSync(
      gentPath,
      `# gent\n\nProject scaffold generated from @waelio/cli blueprint for ${sanitized}.\n`,
      'utf8'
    );
  }

  // Generate waelio.tools.json
  const toolsPath = path.join(projectDir, 'waelio.tools.json');
  if (!fs.existsSync(toolsPath)) {
    fs.writeFileSync(
      toolsPath,
      `${JSON.stringify(WAELIO_CLI_TOOLS, null, 2)}\n`,
      'utf8'
    );
  }

  // Ensure all required project files exist
  for (const file of REQUIRED_PROJECT_FILES) {
    const requiredFilePath = path.join(projectDir, file);
    if (!fs.existsSync(requiredFilePath)) {
      fs.writeFileSync(requiredFilePath, `${file}\n`, 'utf8');
    }
  }

  return projectDir;
}

export function scaffoldFromBlueprint(
  projectsDir: string,
  projectNames: string[]
): string[] {
  return projectNames.map((projectName) =>
    scaffoldProject(projectsDir, projectName)
  );
}
