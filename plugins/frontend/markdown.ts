import { marked } from 'marked';
import katex from 'katex';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { LRUCache } from 'lru-cache';
import hljs from 'highlight.js';

const require = createRequire(import.meta.url);
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window as unknown as import('dompurify').WindowLike);

const renderCache = new LRUCache<string, string>({
    max: 500,
    ttl: 1000 * 60 * 30
});

const inlineMath = {
    name: 'inlineMath',
    level: 'inline' as const,
    start(src: string) { return src.indexOf('$'); },
    tokenizer(src: string) {
        const match = src.match(/^\$([^\$\n]+?)\$/);
        if (match) {
            return { type: 'inlineMath', raw: match[0], text: match[1].trim() };
        }
    },
    renderer(token: { text: string }) {
        return katex.renderToString(token.text, { throwOnError: false, displayMode: false });
    }
};

const blockMath = {
    name: 'blockMath',
    level: 'block' as const,
    start(src: string) { return src.indexOf('$$'); },
    tokenizer(src: string) {
        const match = src.match(/^\$\$([\s\S]+?)\$\$/);
        if (match) {
            return { type: 'blockMath', raw: match[0], text: match[1].trim() };
        }
    },
    renderer(token: { text: string }) {
        return katex.renderToString(token.text, { throwOnError: false, displayMode: true });
    }
};

const codeRenderer = {
    renderer(token: { text: string; lang?: string }) {
        const lang = token.lang || 'plaintext';
        let highlighted: string;
        try {
            highlighted = hljs.highlight(token.text, { language: lang }).value;
        } catch {
            highlighted = hljs.highlightAuto(token.text).value;
        }
        const encoded = encodeURIComponent(token.text);
        return `<div class="lf-code-block"><div class="lf-code-header"><span class="lf-code-lang">${lang}</span><button class="lf-code-copy" data-code="${encoded}"><iconify-icon icon="fluent:copy-16-regular"></iconify-icon></button></div><pre><code class="hljs language-${lang}">${highlighted}</code></pre></div>`;
    }
};

marked.use({ extensions: [inlineMath, blockMath], renderer: { code: codeRenderer.renderer } });

const EMOJI_REGEX = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;

function renderEmoji(emoji: string): string {
    try {
        const codepoint = require('twemoji').convert.toCodePoint(emoji);
        const svgPath = require.resolve(`@twemoji/svg/${codepoint}.svg`);
        const svg = readFileSync(svgPath, 'utf-8')
            .replace('<svg', '<svg width="1.2em" height="1.2em"');
        return svg;
    } catch {
        return emoji;
    }
}

function renderMarkdownUncached(content: string): string {
    const html = marked.parse(content, { async: false }) as string;

    const mathBlocks: string[] = [];
    const protectedHtml = html.replace(
        /<span class="katex[^"]*"[\s\S]*?<\/span>/g,
        (match: string) => {
            mathBlocks.push(match);
            return `__MATH_${mathBlocks.length - 1}__`;
        }
    );

    const sanitized = DOMPurify.sanitize(protectedHtml, {
        ALLOWED_TAGS: [
            'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'del', 'ins',
            'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'span', 'div', 'details', 'summary', 'button'
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title',
            'type', 'checked', 'disabled', 'open', 'start', 'colspan', 'rowspan',
            'class', 'data-code'
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
        FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'base', 'style'],
        FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit'],
        ALLOW_DATA_ATTR: false
    });

    const withFluentLinks = sanitized.replace(
        /<a([^>]*href="[^"]*"[^>]*)>([\s\S]*?)<\/a>/g,
        '<fluent-link$1>$2</fluent-link>'
    );

    const withEmoji = withFluentLinks.replace(EMOJI_REGEX, renderEmoji);

    const withMathRestored = withEmoji.replace(
        /__MATH_(\d+)__/g,
        (_match: string, index: string) => mathBlocks[parseInt(index)]
    );

    return DOMPurify.sanitize(withMathRestored, {
        ALLOWED_TAGS: [
            'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'del', 'ins',
            'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'span', 'div', 'details', 'summary', 'button',
            'fluent-link', 'svg', 'path', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title', 'width', 'height',
            'type', 'checked', 'disabled', 'open', 'start', 'colspan', 'rowspan',
            'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
            'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
            'points', 'transform', 'appearance',
            'class', 'style', 'data-code'
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
        FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'base'],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit'],
        ALLOW_DATA_ATTR: false,
        KEEP_CONTENT: true
    });
}

export function renderMarkdown(content: string): string {
    if (!content) return '';
    const cached = renderCache.get(content);
    if (cached !== undefined) return cached;
    const result = renderMarkdownUncached(content);
    renderCache.set(content, result);
    return result;
}

export const RENDER_VERSION = 2;