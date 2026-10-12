import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import twemojiModule from '@twemoji/api';
import type { Twemoji } from '@twemoji/api';

// @twemoji/api ships CommonJS-shaped type declarations while bundlers resolve
// its ESM build; both expose the same Twemoji object as the default export.
const twemoji = twemojiModule as unknown as Twemoji;

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

const MATH_OPEN = '<span class="katex';
const SPAN_TOKEN = /<span\b[^>]*>|<\/span>/g;

/**
 * Replace every KaTeX block with a placeholder so the first sanitizing pass
 * leaves the generated markup (and its inline styles) untouched.
 */
function protectMath(html: string, store: string[]): string {
    let out = '';
    let cursor = 0;
    let start = html.indexOf(MATH_OPEN, cursor);
    while (start !== -1) {
        const openEnd = html.indexOf('>', start);
        if (openEnd === -1) break;
        SPAN_TOKEN.lastIndex = openEnd + 1;
        let depth = 1;
        let end = -1;
        let token: RegExpExecArray | null;
        while ((token = SPAN_TOKEN.exec(html)) !== null) {
            depth += token[0] === '</span>' ? -1 : 1;
            if (depth === 0) {
                end = SPAN_TOKEN.lastIndex;
                break;
            }
        }
        if (end === -1) break;
        out += html.slice(cursor, start) + `__LF_MATH_${store.length}__`;
        store.push(html.slice(start, end));
        cursor = end;
        start = html.indexOf(MATH_OPEN, cursor);
    }
    return out + html.slice(cursor);
}

function renderMarkdownHtml(content: string): string {
    const html = marked.parse(content, { async: false }) as string;

    const mathBlocks: string[] = [];
    const protectedHtml = protectMath(html, mathBlocks);

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
        /<a(\s[^>]*href="[^"]*"[^>]*)>([\s\S]*?)<\/a>/g,
        '<fluent-link$1>$2</fluent-link>'
    );

    const withMathRestored = withFluentLinks.replace(
        /__LF_MATH_(\d+)__/g,
        (_match: string, index: string) => mathBlocks[parseInt(index)] ?? ''
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
    return renderMarkdownHtml(content);
}

/**
 * Render every `[data-lf-md]` container in the page: raw markdown comes from
 * the server as escaped text, the browser turns it into HTML, and Twemoji
 * swaps emoji characters for the self-hosted SVG assets.
 */
export function renderMarkdownNodes(root: ParentNode = document): void {
    const nodes = root.querySelectorAll<HTMLElement>('[data-lf-md]');
    nodes.forEach((node) => {
        if (node.hasAttribute('data-lf-md-rendered')) return;
        const source = node.textContent ?? '';
        node.innerHTML = renderMarkdown(source);
        twemoji.parse(node, {
            base: '/static/twemoji/',
            folder: 'svg',
            ext: '.svg',
            className: 'lf-emoji'
        });
        node.setAttribute('data-lf-md-rendered', 'true');
    });
}
