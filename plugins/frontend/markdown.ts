import { marked } from 'marked';
import katex from 'katex';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window as unknown as import('dompurify').WindowLike);

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

marked.use({ extensions: [inlineMath, blockMath] });

export function renderMarkdown(content: string): string {
    if (!content) return '';
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
            'span', 'div', 'details', 'summary'
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title',
            'type', 'checked', 'disabled', 'open', 'start', 'colspan', 'rowspan'
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

    const withEmoji = withFluentLinks.replace(
        /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g,
        (emoji: string) => {
            const codepoint = require('twemoji').convert.toCodePoint(emoji);
            try {
                const svgPath = require.resolve(`@twemoji/svg/${codepoint}.svg`);
                const svg = readFileSync(svgPath, 'utf-8')
                    .replace('<svg', '<svg width="1.2em" height="1.2em"');
                return svg;
            } catch {
                return emoji;
            }
        }
    );

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
            'span', 'div', 'details', 'summary',
            'fluent-link', 'svg', 'path', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title', 'width', 'height',
            'type', 'checked', 'disabled', 'open', 'start', 'colspan', 'rowspan',
            'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
            'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
            'points', 'transform', 'appearance',
            'class', 'style'
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
        FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'base'],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit'],
        ALLOW_DATA_ATTR: false,
        KEEP_CONTENT: true
    });
}