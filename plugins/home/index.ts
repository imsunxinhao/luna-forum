import { resolve } from 'path';
import type { Plugin } from '../../src/types.js';
import { readFile } from 'fs/promises';
import { Type } from '@sinclair/typebox';


const homePlugin: Plugin & { pageData: string } = {
  name: 'home',
  version: '0.1.0',
  deps: [],
  pageData: '',

  async init(ctx) {
    this.pageData = await readFile(resolve(import.meta.dirname, 'index.html'), { encoding: 'utf8' })

    const server = ctx.kernel.getServer();
    
    server.get('/', {
      schema: {
        response: {
          200: Type.String()
        }
      }
    }, async (request, reply) => {
      return reply.type('text/html').send(this.pageData);
    });
  },

  async activate() {},
  async deactivate() {}
};
export default homePlugin;