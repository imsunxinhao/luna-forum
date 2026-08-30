import nunjucks from 'nunjucks';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { RenderData } from './types.js';
import { t, setLocale, detectLocale, getLocale } from './i18n.js';
import { getConfig } from '../../src/config.js';
import { getCurrentUser, getUserIdFromRequest } from '../../src/auth.js';
import type { FastifyRequest } from 'fastify';
import { privManager } from '../../src/privmgr.js';
import { renderMarkdown } from './markdown.js';

interface FileSystemLoaderLike {
    searchPaths: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesPath = resolve(__dirname, 'templates');
const env = nunjucks.configure(templatesPath, { autoescape: true });

let currentRequest: unknown = null;

export function setRequest(request: FastifyRequest): void {
    currentRequest = request;
}

function getLoader(environment: nunjucks.Environment): FileSystemLoaderLike {
    return (environment as unknown as { loader: FileSystemLoaderLike }).loader;
}

export function addTemplatePath(path: string): void {
    const loader = getLoader(env);
    if (loader && Array.isArray(loader.searchPaths)) {
        if (!loader.searchPaths.includes(path)) {
            loader.searchPaths.push(path);
        }
    }
}

env.addFilter('_', (key: string, options?: Record<string, unknown>) => t(key, options));

env.addFilter('markdown', (content: string) => {
  return renderMarkdown(content);
});

function getSiteInfo(): Record<string, string> {
    try {
        const config = getConfig() as { site?: { name?: string; description?: string } };
        return {
            name: config.site?.name ?? 'Luna Forum',
            description: config.site?.description ?? ''
        };
    } catch {
        return { name: 'Luna Forum', description: '' };
    }
}

export async function renderPage(
    template: string,
    data: RenderData = {}
): Promise<string> {
    const site = getSiteInfo();
    let user: Record<string, unknown> | null = null, userId = 0;
    if (currentRequest) {
        const request = currentRequest as FastifyRequest;
        user = await getCurrentUser(request);
        userId = getUserIdFromRequest(request);
        setLocale(detectLocale(request.headers));
    }
    const merged: Record<string, unknown> = {
        ...data,
        site,
        user,
        lang: getLocale(),
        bundlePath: '/static/dist/bundle.js',
        stylePath: '/static/dist/bundle.css',
        hasPriv: (permId: string) => privManager.hasPriv(userId, permId)
    };
    if (!merged.title) {
        merged.title = site.name;
    }
    return env.render(template, merged as RenderData) as string;
}

export function renderTemplate(template: string, data: RenderData = {}): string {
    return env.render(template, data) as string;
}