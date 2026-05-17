# builder

Utilising all the tools to build website, according to blueprints.

## What is included

- `gent.md` at repository root
- TypeScript webhook receiver at `POST /webhooks/blueprints`
- Blueprint project scaffolding from `templates/project-template`
- Per-project output under `projects/<project-name>`
- Required project files: `ABOUT`, `CONTACT`, `about`, `CASL.AUTH`, `MONGODB`, `ORM`, `SEO`
- NativeScript preparation via `nativescript.config.ts` in template
- Tool mapping file (`waelio.tools.json`) sourced from `@waelio/cli`

## Usage

```bash
npm install
npm test
npm start
```
