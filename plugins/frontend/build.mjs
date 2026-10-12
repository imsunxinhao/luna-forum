import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cp, mkdir, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'module';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function findPackageRoot(startDir, pkgName) {
    let dir = startDir;
    while (dir) {
        const pkgJson = resolve(dir, 'package.json');
        try {
            const pkg = require(pkgJson);
            if (pkg.name === pkgName) return dir;
        } catch {}
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

const monacoMain = require.resolve('monaco-editor');
const monacoPkgDir = findPackageRoot(dirname(monacoMain), 'monaco-editor');
if (!monacoPkgDir) throw new Error('Cannot locate monaco-editor package root');

async function copyTwemojiAssets() {
    const dest = resolve(__dirname, 'public/twemoji/svg');
    let src;
    let source = [];
    try {
        const pkgDir = dirname(fileURLToPath(import.meta.resolve('@twemoji/svg/package.json')));
        src = await realpath(pkgDir);
        source = await readdir(src);
    } catch {
        console.warn('Twemoji assets not found, emoji will fall back to plain text');
        return;
    }
    let target = [];
    try {
        target = await readdir(dest);
    } catch {
        target = [];
    }
    if (target.length >= source.length) return;
    await mkdir(dest, { recursive: true });
    await cp(src, dest, { recursive: true, force: false, errorOnExist: false });
    console.log(`Twemoji assets copied (${source.length} files)`);
}

async function copyKatexAssets() {
    const dest = resolve(__dirname, 'public/katex');
    const sourceMap = {
        'dist/katex.min.css': 'katex.min.css',
        'dist/fonts': 'fonts'
    };
    try {
        const main = require.resolve('katex');
        const katexPkgDir = findPackageRoot(dirname(main), 'katex');
        if (!katexPkgDir) throw new Error('katex package root not found');
        const realPkgDir = await realpath(katexPkgDir);
        await mkdir(dest, { recursive: true });
        for (const [rel, out] of Object.entries(sourceMap)) {
            const from = resolve(realPkgDir, rel);
            const to = resolve(dest, out);
            await cp(from, to, { recursive: true, force: true });
        }
        console.log('KaTeX assets copied');
    } catch (err) {
        console.warn('KaTeX assets not found, math styling may be incomplete', err);
    }
}

async function copyMonacoAssets() {
    const src = resolve(monacoPkgDir, 'min/vs');
    const dest = resolve(__dirname, 'public/monaco/min/vs');
    if (!existsSync(src)) {
        console.warn('monaco min/vs not found, iframe editor will not work');
        return;
    }
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true, force: true });
    console.log('Monaco assets copied');
}

async function collectPageEntries() {
    const pageDir = resolve(__dirname, 'src/page');
    const entries = {};
    let files;
    try {
        files = await readdir(pageDir);
    } catch {
        return entries;
    }
    for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (file.endsWith('.d.ts')) continue;
        if (file.startsWith('_')) continue;
        const name = file.slice(0, -3);
        entries[name] = resolve(pageDir, file);
    }
    return entries;
}

await copyTwemojiAssets();
await copyKatexAssets();
await copyMonacoAssets();

const pageEntries = await collectPageEntries();
console.log('Page entries:', Object.keys(pageEntries));

await esbuild.build({
    entryPoints: {
        bundle: resolve(__dirname, 'src/main.ts'),
        ...pageEntries
    },
    outdir: resolve(__dirname, 'public/dist'),
    bundle: true,
    format: 'esm',
    splitting: true,
    target: 'es2020',
    minify: false,
    sourcemap: false,
    loader: {
        '.css': 'css',
        '.woff': 'file',
        '.woff2': 'file',
        '.ttf': 'file'
    },
    ignoreAnnotations: true
});

console.log('Frontend bundle built');