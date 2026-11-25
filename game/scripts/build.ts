// Builds the game into self-contained static folders, one per distribution
// target, and zips each one ready for upload.
//
//   node scripts/build.ts --all              every target, minified, zipped
//   node scripts/build.ts --target=web       one target
//   node scripts/build.ts --target=web --serve   dev server with rebuild on reload
//
// Targets differ only in the platform adapter that is compiled in and in
// whether outbound links (tip jar, store page) are allowed:
//   web               GitHub Pages or any static host. Tip link allowed.
//   itch              itch.io HTML5 upload. Tip link points at the itch page.
//   crazygames        CrazyGames SDK v3. No outbound links.
//   gamedistribution  GameDistribution HTML5 SDK. No outbound links.

import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = ['web', 'itch', 'crazygames', 'gamedistribution'] as const;
export type Target = (typeof TARGETS)[number];

export interface GameConfig {
  title: string;
  slug: string;
  tagline: string;
  description: string;
  themeColor: string;
  /** PayPal donate link or Ko-fi page. Leave empty to hide the tip button. */
  tipUrl: string;
  /** Public itch.io page, e.g. https://name.itch.io/slug. Leave empty to hide. */
  itchPageUrl: string;
  /** Game ID issued by GameDistribution after the game is registered there. */
  gameDistributionId: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// GF_DIST lets parallel jobs (or tests) build into separate folders without tripping over each other.
const distRoot = process.env['GF_DIST'] ? path.resolve(process.env['GF_DIST']) : path.join(root, 'dist');

export async function loadConfig(): Promise<GameConfig> {
  return JSON.parse(await readFile(path.join(root, 'game.config.json'), 'utf8')) as GameConfig;
}

async function readVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Script tags each portal requires in the page head. */
function platformHead(target: Target): string {
  if (target === 'crazygames') {
    return '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>';
  }
  return '';
}

function buildOptions(target: Target, config: GameConfig, version: string, dev: boolean): esbuild.BuildOptions {
  const outbound = target === 'web' || target === 'itch';
  const tipUrl = !outbound ? '' : target === 'itch' && config.itchPageUrl ? config.itchPageUrl : config.tipUrl;
  return {
    entryPoints: [path.join(root, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    outfile: path.join(distRoot, target, 'game.js'),
    logLevel: 'warning',
    define: {
      __PLATFORM__: JSON.stringify(target),
      __VERSION__: JSON.stringify(version),
      __DEV__: JSON.stringify(dev),
      __TITLE__: JSON.stringify(config.title),
      __TIP_URL__: JSON.stringify(tipUrl),
      __GD_GAME_ID__: JSON.stringify(config.gameDistributionId),
    },
  };
}

async function writeStatic(target: Target, config: GameConfig, version: string): Promise<void> {
  const out = path.join(distRoot, target);
  await mkdir(out, { recursive: true });
  const template = await readFile(path.join(root, 'index.html'), 'utf8');
  const html = template
    .replaceAll('%TITLE%', escapeHtml(config.title))
    .replaceAll('%TAGLINE%', escapeHtml(config.tagline))
    .replaceAll('%DESCRIPTION%', escapeHtml(config.description))
    .replaceAll('%THEME_COLOR%', escapeHtml(config.themeColor))
    .replaceAll('%VERSION%', escapeHtml(version))
    .replaceAll('%PLATFORM_HEAD%', platformHead(target));
  await writeFile(path.join(out, 'index.html'), html);
  const staticDir = path.join(root, 'static');
  if (existsSync(staticDir)) await cp(staticDir, out, { recursive: true });
}

export async function buildTarget(target: Target, options: { dev?: boolean; zip?: boolean } = {}): Promise<string> {
  const config = await loadConfig();
  const version = await readVersion();
  const out = path.join(distRoot, target);
  await rm(out, { recursive: true, force: true });
  await writeStatic(target, config, version);
  await esbuild.build(buildOptions(target, config, version, options.dev ?? false));
  if (options.zip) {
    const zips = path.join(distRoot, 'zips');
    await mkdir(zips, { recursive: true });
    const zipPath = path.join(zips, `${config.slug}-${target}-v${version}.zip`);
    await rm(zipPath, { force: true });
    // -X drops extra file attributes so the archive is reproducible; portals
    // expect index.html at the archive root, so zip from inside the folder.
    execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: out });
  }
  return out;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Minimal static file server, used by the dev command and the browser tests. */
export function serveDirectory(dir: string, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const base = path.resolve(dir);
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
        const file = path.resolve(base, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
        if (file !== base && !file.startsWith(base + path.sep)) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('Not found');
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${actualPort}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const serve = args.includes('--serve');
  const targetArg = args.find((a) => a.startsWith('--target='))?.slice('--target='.length);
  if (targetArg && !(TARGETS as readonly string[]).includes(targetArg)) {
    throw new Error(`Unknown target "${targetArg}". Expected one of: ${TARGETS.join(', ')}`);
  }

  if (serve) {
    const target = (targetArg ?? 'web') as Target;
    await buildTarget(target, { dev: true });
    const config = await loadConfig();
    const version = await readVersion();
    const context = await esbuild.context(buildOptions(target, config, version, true));
    await context.watch();
    const { url } = await serveDirectory(path.join(distRoot, target), 5173);
    console.log(`Serving ${target} build at ${url} (rebuilds on change; reload the page)`);
    return;
  }

  const targets: Target[] = all || !targetArg ? [...TARGETS] : [targetArg as Target];
  for (const target of targets) {
    const out = await buildTarget(target, { zip: true });
    console.log(`built ${target} -> ${path.relative(root, out)}`);
  }
}

// Run only when executed directly, so tests can import the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
