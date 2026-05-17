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

const REPO_ROOT =
  process.env.WAELIO_BUILDER_ROOT ?? process.cwd();

const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'project-template');

export const WAELIO_CLI_TOOLS = {
  source: '@waelio/cli',
  localTools: ['builder', 'blueprint-webhook', 'project-template'],
  externalTools: ['casl', 'mongodb', 'orm', 'seo']
};

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
