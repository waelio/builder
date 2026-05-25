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
const READY_SITE_ROUTE = '/ready-sites';

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

export interface ReadySite {
  name: string;
  projectPath: string;
  readySitePath: string;
  url: string;
}

export interface BlueprintBuildResult {
  projects: string[];
  sites: ReadySite[];
}

export interface BlueprintBuildOptions {
  projectsDir: string;
  readySitesDir: string;
  baseUrl?: string;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReadySiteUrl(baseUrl: string | undefined, siteName: string): string {
  const pathSegment = `${READY_SITE_ROUTE}/${encodeURIComponent(siteName)}/`;
  if (!baseUrl) return pathSegment;
  return `${baseUrl.replace(/\/+$/g, '')}${pathSegment}`;
}

function renderReadySiteHtml(siteName: string, projectPath: string): string {
  const escapedName = escapeHtml(siteName);
  const escapedProjectPath = escapeHtml(projectPath);
  const requiredFiles = REQUIRED_PROJECT_FILES
    .map((file) => `<li><code>${escapeHtml(file)}</code></li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedName} | Siforge Ready Site</title>
  <meta name="description" content="Siforge ready-site generated from an @waelio/cli blueprint" />
  <style>
    :root{color-scheme:dark;--bg:#09090f;--panel:#141421;--line:#27273a;--text:#f2f2ff;--muted:#a1a1bb;--accent:#7c3aed}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#1f1b4d 0,#09090f 42%);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;padding:32px}
    main{width:min(760px,100%);background:rgba(20,20,33,.92);border:1px solid var(--line);border-radius:24px;padding:36px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    .eyebrow{color:#c4b5fd;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
    h1{font-size:clamp(36px,8vw,72px);line-height:.95;margin:16px 0}
    p{color:var(--muted);font-size:18px;line-height:1.65;margin:0 0 24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:28px}
    section{border:1px solid var(--line);border-radius:16px;padding:18px;background:rgba(255,255,255,.03)}
    h2{font-size:14px;margin:0 0 12px;color:#ddd6fe;text-transform:uppercase;letter-spacing:.08em}
    code{color:#ddd6fe}
    ul{margin:0;padding-left:18px;color:var(--muted);line-height:1.7}
    a{color:#c4b5fd}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Siforge Ready Site</div>
    <h1>${escapedName}</h1>
    <p>This site was generated from an <code>@waelio/cli</code> blueprint, built by <code>@waelio/builder</code>, and hosted from <code>readysites/ready-sites</code>.</p>
    <div class="grid">
      <section>
        <h2>Blueprint workspace</h2>
        <p><code>${escapedProjectPath}</code></p>
      </section>
      <section>
        <h2>Generated files</h2>
        <ul>${requiredFiles}</ul>
      </section>
      <section>
        <h2>Manifest</h2>
        <p><a href="./blueprint.json">Open blueprint.json</a></p>
      </section>
    </div>
  </main>
</body>
</html>
`;
}

function buildReadySite(
  readySitesDir: string,
  projectName: string,
  projectPath: string,
  baseUrl?: string
): ReadySite {
  const siteName = sanitizeProjectName(projectName);
  const readySitePath = path.join(readySitesDir, siteName);
  fs.mkdirSync(readySitePath, { recursive: true });

  const manifest = {
    source: '@waelio/cli',
    builder: '@waelio/builder',
    host: 'siforge-ready-sites',
    name: siteName,
    projectPath,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(readySitePath, 'index.html'),
    renderReadySiteHtml(siteName, projectPath),
    'utf8'
  );
  fs.writeFileSync(
    path.join(readySitePath, 'blueprint.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  return {
    name: siteName,
    projectPath,
    readySitePath,
    url: buildReadySiteUrl(baseUrl, siteName),
  };
}

export function scaffoldFromBlueprint(
  projectsDir: string,
  projectNames: string[]
): string[] {
  return projectNames.map((projectName) =>
    scaffoldProject(projectsDir, projectName)
  );
}

export function buildBlueprintReadySites(
  options: BlueprintBuildOptions,
  projectNames: string[]
): BlueprintBuildResult {
  const projects = scaffoldFromBlueprint(options.projectsDir, projectNames);
  fs.mkdirSync(options.readySitesDir, { recursive: true });

  const sites = projectNames.map((projectName, index) =>
    buildReadySite(
      options.readySitesDir,
      projectName,
      projects[index],
      options.baseUrl
    )
  );

  return { projects, sites };
}
