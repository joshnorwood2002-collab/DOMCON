// Packs the web build into one self-contained HTML file with the styles and
// the script inlined. Useful wherever only a single file can be shared or
// hosted. The file has no <html>, <head> or <body> tags of its own, so it can
// be opened directly in a browser or dropped into a host that supplies them.
//
//   node scripts/single-file.ts [output.html]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTarget, loadConfig } from './build.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function buildSingleFile(output: string): Promise<number> {
  const config = await loadConfig();
  const dist = await buildTarget('web', { zip: false });
  const css = await readFile(path.join(dist, 'game.css'), 'utf8');
  // A closing script tag inside the bundle would end the inline script early.
  const js = (await readFile(path.join(dist, 'game.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
  const html = [
    `<title>${escapeHtml(config.title)}</title>`,
    `<meta name="description" content="${escapeHtml(config.description).replace(/"/g, '&quot;')}">`,
    '<style>',
    // One deliberate look: the deep sea is dark whatever theme the host uses.
    `:root { color-scheme: dark; background: ${config.themeColor}; }`,
    'html, body { height: 100%; }',
    css.replace(/<\/style/gi, '<\\/style'),
    '</style>',
    '<div id="app"></div>',
    `<noscript>${escapeHtml(config.title)} needs JavaScript to run.</noscript>`,
    '<script>',
    js,
    '</script>',
    '',
  ].join('\n');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html);
  return html.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'single', 'glowfathom.html'));
  const size = await buildSingleFile(output);
  console.log(`wrote ${path.relative(process.cwd(), output)} (${Math.round(size / 1024)} KB)`);
}
