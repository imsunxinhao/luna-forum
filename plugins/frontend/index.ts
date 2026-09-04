import type { Plugin } from '../../src/types.js';
import type { RenderData } from './types.js';
import { setupFrontendRoutes } from './routes.js';
import { renderTemplate, addTemplatePath } from './render.js';
import { initI18n } from './i18n.js';

const frontendPlugin: Plugin = {
    name: 'frontend',
    version: '0.1.0',
    deps: ['post'],
    async init(ctx) {
        await initI18n();
        ctx.registerCommand('template:addPath', async (...args: unknown[]) => {
            const path = args[0] as string;
            addTemplatePath(path);
            return { success: true };
        });
        ctx.registerCommand('template:render', async (...args: unknown[]) => {
            const template = args[0] as string;
            const data = (args[1] ?? {}) as RenderData;
            return renderTemplate(template, data);
        });
        const server = ctx.kernel.getServer();
        setupFrontendRoutes(server);
    },
    async activate() { },
    async deactivate() { }
};
export default frontendPlugin;