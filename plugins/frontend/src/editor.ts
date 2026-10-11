import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import twemojiModule from '@twemoji/api';
import type { Twemoji } from '@twemoji/api';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import 'highlight.js/styles/github-dark.css';

const twemoji = twemojiModule as unknown as Twemoji;

const MONACO_BASE = '/static/monaco/min/vs';

const PH_START = '\uE000';
const PH_END = '\uE001';
const DEBOUNCE_MS = 150;

const inlineMath = {
    name: 'inlineMath',
    level: 'inline' as const,
    start(src: string) { return src.indexOf('$'); },
    tokenizer(src: string) {
        const match = src.match(/^\$([^\$\n]+?)\$/);
        if (match) return { type: 'inlineMath', raw: match[0], text: match[1].trim() };
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
        if (match) return { type: 'blockMath', raw: match[0], text: match[1].trim() };
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
        return `<div class="me-code-block"><div class="me-code-header"><span class="me-code-lang">${lang}</span><button type="button" class="me-code-copy" data-code="${encoded}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div><pre><code class="hljs language-${lang}">${highlighted}</code></pre></div>`;
    }
};

marked.use({ extensions: [inlineMath, blockMath], renderer: { code: codeRenderer.renderer } });

const MATH_OPEN = '<span class="katex';
const SPAN_TOKEN = /<span\b[^>]*>|<\/span>/g;

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
            if (depth === 0) { end = SPAN_TOKEN.lastIndex; break; }
        }
        if (end === -1) break;
        out += html.slice(cursor, start) + `__ME_MATH_${store.length}__`;
        store.push(html.slice(start, end));
        cursor = end;
        start = html.indexOf(MATH_OPEN, cursor);
    }
    return out + html.slice(cursor);
}

const SANITIZE_BASE = {
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
};

const SANITIZE_FINAL = {
    ...SANITIZE_BASE,
    ALLOWED_TAGS: [...SANITIZE_BASE.ALLOWED_TAGS, 'svg', 'path', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'],
    ALLOWED_ATTR: [
        ...SANITIZE_BASE.ALLOWED_ATTR,
        'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width',
        'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
        'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'transform', 'style'
    ],
    FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'base'],
    KEEP_CONTENT: true
};

export function renderMarkdown(content: string): string {
    if (!content) return '';
    const html = marked.parse(content, { async: false }) as string;
    const mathBlocks: string[] = [];
    const protectedHtml = protectMath(html, mathBlocks);
    const sanitized = DOMPurify.sanitize(protectedHtml, SANITIZE_BASE);
    const restored = sanitized.replace(/__ME_MATH_(\d+)__/g, (_m, i) => mathBlocks[parseInt(i)] ?? '');
    return DOMPurify.sanitize(restored, SANITIZE_FINAL);
}

const ICONS = {
    bold: '<svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
    italic: '<svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    heading: '<svg viewBox="0 0 24 24"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>',
    code: '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    list: '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    quote: '<svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
};

export type MarkdownEditorTheme = 'auto' | 'light' | 'dark';

export interface MarkdownEditorOptions {
    selector: string | HTMLElement;
    value?: string;
    theme?: MarkdownEditorTheme;
    height?: string;
    name?: string;
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;   // 新增
    onReady?: (editor: MarkdownEditor) => void;
}

export class MarkdownEditor {
    private host: HTMLElement;
    private shadow: ShadowRoot;
    private iframe!: HTMLIFrameElement;
    private previewEl!: HTMLElement;
    private themeBtn!: HTMLButtonElement;
    private hiddenInput!: HTMLInputElement;
    private loadingEl!: HTMLElement;

    private markdown: string;
    private theme: MarkdownEditorTheme;
    private onChange?: (value: string) => void;
    private onSubmit?: (value: string) => void;
    private onReady?: (editor: MarkdownEditor) => void;

    private previewTimer: number | null = null;
    private systemMQ: MediaQueryList | null = null;
    private systemListener: ((e: MediaQueryListEvent) => void) | null = null;
    private copyHandler: ((e: Event) => void) | null = null;
    private messageHandler: ((e: MessageEvent) => void) | null = null;
    private iframeReady = false;
    private destroyed = false;
    private fieldName: string;
    private selectionRequests: Record<string, (value: string) => void> = Object.create(null);

    constructor(options: MarkdownEditorOptions) {
        if (!options || !options.selector) throw new Error('[MarkdownEditor] options.selector 必传');
        const host = typeof options.selector === 'string'
            ? document.querySelector<HTMLElement>(options.selector)
            : options.selector;
        if (!host) throw new Error('[MarkdownEditor] 找不到宿主元素');

        this.host = host;
        this.markdown = options.value ?? '';
        this.theme = options.theme ?? 'auto';
        this.onChange = options.onChange;
        this.onReady = options.onReady;
        this.fieldName = options.name ?? '';

        this.shadow = host.attachShadow({ mode: 'open' });
        this.shadow.innerHTML = this.template(options.height ?? '60vh');
        this.bindElements();
        this.bindMessages();
        this.bindToolbar();
        this.bindCopy();
        this.applyTheme();
        this.bindSystemTheme();
        this.renderPreview();
        this.syncHiddenInput();
        this.initIframe();

        this.onReady?.(this);
    }

    static init(options: MarkdownEditorOptions): MarkdownEditor {
        return new MarkdownEditor(options);
    }

    static readonly version = '3.1.0';

    private template(height: string): string {
        const buttons = [
            { key: 'bold', title: '加粗' },
            { key: 'italic', title: '斜体' },
            { key: 'heading', title: '标题' },
            { key: 'code', title: '代码块' },
            { key: 'link', title: '链接' },
            { key: 'list', title: '列表' },
            { key: 'quote', title: '引用' }
        ];
        const toolbar = buttons.map(b =>
            `<button type="button" class="me-btn" data-action="${b.key}" title="${b.title}" aria-label="${b.title}">${(ICONS as Record<string, string>)[b.key]}</button>`
        ).join('');

        const inputName = this.fieldName ? ` name="${this.fieldName}"` : '';

        return `
      <style>${this.styles()}</style>
      <div class="me-root">
        <div class="me-toolbar">
          ${toolbar}
          <button type="button" class="me-theme-toggle" title="切换深浅色模式">
            <span class="me-theme-icon">${ICONS.moon}</span>
            <span class="me-theme-text">深色</span>
          </button>
        </div>
        <div class="me-body" style="height:${height}">
          <div class="me-pane me-editor-pane">
            <iframe class="me-iframe" title="Markdown Editor"></iframe>
            <div class="me-loading">正在加载编辑器…</div>
          </div>
          <div class="me-pane me-preview-pane"><div class="me-preview"></div></div>
        </div>
        <input type="hidden" class="me-hidden-input"${inputName}>
      </div>
    `;
    }

    private styles(): string {
        return `
      :host { display: block; width: 100%; }
      *, *::before, *::after { box-sizing: border-box; }
      .me-root {
        background: var(--md-bg-primary, #fff);
        border: 1px solid var(--md-border, #d2d0ce);
        border-radius: 5px;
        overflow: hidden;
        display: flex; flex-direction: column;
      }
      .me-toolbar {
        display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
        padding: 6px 8px;
        background: var(--md-bg-secondary, #f3f2f1);
        border-bottom: 1px solid var(--md-border, #d2d0ce);
      }
      .me-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; padding: 0;
        border: none; background: transparent;
        color: var(--md-fg-primary, #323130);
        border-radius: 5px; cursor: pointer; outline: none; user-select: none;
      }
      .me-btn:hover { background-color: var(--md-hover, #f3f2f1); }
      .me-btn:active { background-color: var(--md-active, #edebe9); }
      .me-btn svg {
        width: 18px; height: 18px; fill: none; stroke: currentColor;
        stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; display: block;
      }
      .me-theme-toggle {
        margin-left: auto;
        display: inline-flex; align-items: center; gap: 6px;
        border-radius: 5px; padding: 0 10px; height: 32px;
        background: transparent; border: 1px solid var(--md-border, #d2d0ce);
        color: var(--md-fg-primary, #323130);
        cursor: pointer; font-size: 13px; font-family: inherit;
      }
      .me-theme-toggle:hover { background-color: var(--md-hover, #f3f2f1); }
      .me-theme-toggle svg {
        width: 16px; height: 16px; fill: none; stroke: currentColor;
        stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; display: block;
      }
      .me-body {
        display: flex; flex-direction: row; flex-wrap: nowrap;
        min-height: 400px; max-height: 900px;
        background: var(--md-bg-primary, #fff);
      }
      .me-pane {
        flex: 1 1 50%; min-width: 0; overflow: hidden;
        background: var(--md-bg-primary, #fff);
        display: flex; flex-direction: column;
      }
      .me-editor-pane { border-right: 1px solid var(--md-border, #d2d0ce); position: relative; }
      .me-iframe { width: 100%; height: 100%; border: 0; background: var(--md-bg-primary, #fff); display: block; }
      .me-loading {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        color: var(--md-fg-secondary, #605e5c); font-size: 13px;
        pointer-events: none; z-index: 1;
      }
      .me-loading.me-hidden { display: none; }
      .me-preview {
        padding: 12px 14px; width: 100%; height: 100%; overflow: auto;
        color: var(--md-fg-primary, #323130); font-size: 14px; line-height: 1.6;
      }
      .me-preview h1, .me-preview h2, .me-preview h3,
      .me-preview h4, .me-preview h5, .me-preview h6 {
        margin: 0.5em 0 0.3em; font-weight: 600;
        color: var(--md-fg-primary, #323130);
      }
      .me-preview h1 { font-size: 1.8em; border-bottom: 1px solid var(--md-border, #d2d0ce); padding-bottom: 0.2em; }
      .me-preview h2 { font-size: 1.5em; border-bottom: 1px solid var(--md-border, #d2d0ce); padding-bottom: 0.2em; }
      .me-preview h3 { font-size: 1.25em; }
      .me-preview p { margin: 0.5em 0; }
      .me-preview a { color: var(--md-accent, #0078d4); text-decoration: underline; }
      .me-preview code {
        font-family: "Cascadia Code", "Fira Code", monospace;
        background: var(--md-code-bg, #f3f2f1);
        padding: 0.2em 0.4em; border-radius: 5px; font-size: 0.9em;
      }
      .me-preview pre {
        background: var(--md-code-bg, #f3f2f1);
        padding: 10px; border-radius: 5px; overflow-x: auto;
        margin: 0.8em 0; border: 1px solid var(--md-border, #d2d0ce);
      }
      .me-preview pre code { background: transparent; padding: 0; }
      .me-preview blockquote {
        border-left: 4px solid var(--md-accent, #0078d4);
        padding-left: 12px; margin: 0.8em 0;
        color: var(--md-fg-secondary, #605e5c);
      }
      .me-preview ul, .me-preview ol { padding-left: 1.5em; margin: 0.5em 0; }
      .me-preview li { margin: 0.2em 0; }
      .me-preview table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
      .me-preview th, .me-preview td { border: 1px solid var(--md-border, #d2d0ce); padding: 6px 10px; text-align: left; }
      .me-preview th { background: var(--md-bg-secondary, #f3f2f1); font-weight: 600; }
      .me-preview hr { border: none; border-top: 1px solid var(--md-border, #d2d0ce); margin: 1em 0; }
      .me-preview img { max-width: 100%; border-radius: 5px; }
      .me-preview .katex-display { margin: 1em 0; overflow-x: auto; overflow-y: hidden; }
      .me-preview .me-code-block {
        margin: 0.8em 0;
        border: 1px solid var(--md-border, #d2d0ce);
        border-radius: 5px; overflow: hidden;
        background: var(--md-code-bg, #f3f2f1);
      }
      .me-preview .me-code-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 10px;
        background: var(--md-bg-secondary, #f3f2f1);
        border-bottom: 1px solid var(--md-border, #d2d0ce);
        font-size: 12px; color: var(--md-fg-secondary, #605e5c);
      }
      .me-preview .me-code-copy {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; padding: 0;
        border: none; background: transparent;
        color: var(--md-fg-secondary, #605e5c);
        border-radius: 4px; cursor: pointer;
      }
      .me-preview .me-code-copy:hover { background: var(--md-hover, #e1dfdd); }
      .me-preview .me-code-copy svg { display: block; }
      .me-preview .me-code-block pre {
        margin: 0; border: none; border-radius: 0; background: transparent;
      }
      .me-preview .me-emoji {
        width: 1.2em; height: 1.2em;
        vertical-align: -0.2em;
        display: inline-block; margin: 0 0.05em;
      }
      .me-hidden-input { display: none !important; }
      .me-body ::-webkit-scrollbar { width: 10px; height: 10px; }
      .me-body ::-webkit-scrollbar-track { background: var(--md-scrollbar-track, #f3f2f1); }
      .me-body ::-webkit-scrollbar-thumb { background: var(--md-scrollbar-thumb, #c8c6c4); border-radius: 5px; }
      @media (max-width: 600px) {
        .me-body { flex-direction: column; height: auto !important; min-height: 500px; }
        .me-editor-pane { border-right: none; border-bottom: 1px solid var(--md-border, #d2d0ce); min-height: 250px; }
        .me-pane { flex: 1 1 auto; }
      }
    `;
    }

    private bindElements(): void {
        this.iframe = this.shadow.querySelector('.me-iframe') as HTMLIFrameElement;
        this.previewEl = this.shadow.querySelector('.me-preview')!;
        this.themeBtn = this.shadow.querySelector('.me-theme-toggle') as HTMLButtonElement;
        this.hiddenInput = this.shadow.querySelector('.me-hidden-input') as HTMLInputElement;
        this.loadingEl = this.shadow.querySelector('.me-loading')!;
    }

    private bindMessages(): void {
        this.messageHandler = (e: MessageEvent) => {
            const data = e.data;
            if (!data || typeof data !== 'object') return;
            if (e.source !== this.iframe.contentWindow) return;

            if (data.type === 'me-ready') {
                this.iframeReady = true;
                this.post({ type: 'me-set-value', value: this.markdown });
                this.loadingEl.classList.add('me-hidden');
            } else if (data.type === 'me-change') {
                this.markdown = data.value;
                this.syncHiddenInput();
                this.schedulePreview();
                this.onChange?.(this.markdown);
            } else if (data.type === 'me-selection') {
                const cb = this.selectionRequests[data.requestId];
                if (cb) { cb(data.value); delete this.selectionRequests[data.requestId]; }
            } else if (data.type === 'me-error') {
                console.error('[MarkdownEditor] iframe error:', data.error);
                this.loadingEl.textContent = '编辑器加载失败：' + data.error;
            } else if (data.type === 'me-log') {
                console.log('[me-iframe]', data.msg);
            }
        };
        window.addEventListener('message', this.messageHandler);
    }

    private initIframe(): void {
        this.iframe.srcdoc = this.buildIframeHtml(this.effectiveTheme());
    }

    private buildIframeHtml(theme: 'light' | 'dark'): string {
        const vsTheme = theme === 'dark' ? 'vs-dark' : 'vs';
        const bg = theme === 'dark' ? '#1b1a19' : '#ffffff';
        const tagOpen = '<' + 'script';
        const tagClose = '<' + '/' + 'script' + '>';

        return [
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>',
            'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:' + bg + ';}',
            '#container{width:100%;height:100%;}',
            '</style></head><body><div id="container"></div>',
            tagOpen + '>',
            '(function(){',
            '  function fail(err){parent.postMessage({type:"me-error",error:String(err)},"*");}',
            '  function log(msg){parent.postMessage({type:"me-log",msg:String(msg)},"*");}',
            '  log("iframe script started");',
            '  var s=document.createElement("script");',
            '  s.src="' + MONACO_BASE + '/loader.js";',
            '  s.onload=function(){',
            '    log("loader loaded, typeof require=" + typeof require);',
            '    try{',
            '      require.config({paths:{vs:"' + MONACO_BASE + '"}});',
            '      require(["vs/editor/editor.main"],function(){',
            '        log("editor.main loaded");',
            '        var editor=monaco.editor.create(document.getElementById("container"),{',
            '          value:"", language:"markdown", theme:"' + vsTheme + '",',
            '          automaticLayout:true, minimap:{enabled:false}, fontSize:14,',
            '          lineNumbers:"on", scrollBeyondLastLine:false, wordWrap:"on", tabSize:4,',
            '          fontFamily:"\'Cascadia Code\',\'Fira Code\',Consolas,monospace",',
            '          scrollbar:{verticalScrollbarSize:10,horizontalScrollbarSize:10,useShadows:false},',
            '          overviewRulerBorder:false, renderLineHighlight:"none", folding:false,',
            '          glyphMargin:false, fixedOverflowWidgets:true',
            '        });',
            '        editor.onDidChangeModelContent(function(){',
            '          try{parent.postMessage({type:"me-change",value:editor.getValue()},"*");}catch(e){}',
            '        });',
            '        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function(){',
            '          parent.postMessage({type:"me-submit"},"*");',
            '        });',
            '        window.addEventListener("message",function(e){',
            '          var d=e.data||{};',
            '          if(d.type==="me-set-value"&&typeof d.value==="string"){',
            '            if(editor.getValue()!==d.value)editor.setValue(d.value);',
            '          }else if(d.type==="me-set-theme"){',
            '            monaco.editor.setTheme(d.theme==="dark"?"vs-dark":"vs");',
            '            document.body.style.background=d.theme==="dark"?"#1b1a19":"#ffffff";',
            '          }else if(d.type==="me-insert"){',
            '            var sel=editor.getSelection();',
            '            if(sel){editor.executeEdits("toolbar",[{range:sel,text:d.text,forceMoveMarkers:true}]);editor.focus();}',
            '          }else if(d.type==="me-get-selection"){',
            '            var sel=editor.getSelection(),model=editor.getModel(),text="";',
            '            if(sel&&model)text=model.getValueInRange(sel);',
            '            parent.postMessage({type:"me-selection",requestId:d.requestId,value:text},"*");',
            '          }',
            '        });',
            '        parent.postMessage({type:"me-ready"},"*");',
            '      },fail);',
            '    }catch(err){fail(err);}',
            '  };',
            '  s.onerror=function(){fail("loader.js load failed");};',
            '  document.head.appendChild(s);',
            '})();',
            tagClose + '</body></html>'
        ].join('\n');
    }

    private post(msg: unknown): void {
        this.iframe?.contentWindow?.postMessage(msg, '*');
    }

    private bindToolbar(): void {
        this.shadow.querySelectorAll<HTMLButtonElement>('.me-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                this.insertMarkdown(btn.dataset.action || '');
            });
        });
        this.themeBtn.addEventListener('click', () => this.toggleTheme());
    }

    private bindCopy(): void {
        this.copyHandler = (e: Event) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('.me-code-copy') as HTMLButtonElement | null;
            if (!btn) return;
            const code = decodeURIComponent(btn.dataset.code || '');
            navigator.clipboard.writeText(code).then(() => {
                const original = btn.innerHTML;
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                setTimeout(() => { btn.innerHTML = original; }, 1200);
            }).catch(() => { });
        };
        this.previewEl.addEventListener('click', this.copyHandler);
    }

    private insertMarkdown(action: string): void {
        if (!this.iframeReady) return;
        const requestId = 'sel_' + Date.now() + '_' + Math.random();
        this.selectionRequests[requestId] = (selected) => {
            const text = this.composeInsertText(action, selected);
            this.post({ type: 'me-insert', text });
        };
        this.post({ type: 'me-get-selection', requestId });
    }

    private composeInsertText(action: string, selected: string): string {
        switch (action) {
            case 'bold': return `**${selected || '粗体'}**`;
            case 'italic': return `*${selected || '斜体'}*`;
            case 'heading': return `## ${selected || '标题'}`;
            case 'code': return selected ? '```\n' + selected + '\n```' : '```\n代码块\n```';
            case 'link': return `[${selected || '链接文字'}](url)`;
            case 'list': return `- ${selected || '列表项'}`;
            case 'quote': return `> ${selected || '引用'}`;
            default: return '';
        }
    }

    private schedulePreview(): void {
        if (this.previewTimer !== null) clearTimeout(this.previewTimer);
        this.previewTimer = window.setTimeout(() => {
            this.previewTimer = null;
            this.renderPreview();
        }, DEBOUNCE_MS);
    }

    private renderPreview(): void {
        this.previewEl.innerHTML = renderMarkdown(this.markdown);
        twemoji.parse(this.previewEl, {
            base: '/static/twemoji/',
            folder: 'svg',
            ext: '.svg',
            className: 'me-emoji'
        });
    }

    private effectiveTheme(): 'light' | 'dark' {
        if (this.theme === 'light' || this.theme === 'dark') return this.theme;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    private applyTheme(): void {
        const t = this.effectiveTheme();
        document.body.classList.toggle('md-dark', t === 'dark');
        this.post({ type: 'me-set-theme', theme: t });
        this.updateThemeButton(t);
    }

    private updateThemeButton(t: 'light' | 'dark'): void {
        const iconEl = this.themeBtn.querySelector('.me-theme-icon');
        const textEl = this.themeBtn.querySelector('.me-theme-text');
        if (iconEl) iconEl.innerHTML = t === 'dark' ? ICONS.sun : ICONS.moon;
        if (textEl) textEl.textContent = t === 'dark' ? '浅色' : '深色';
    }

    private toggleTheme(): void {
        this.theme = this.effectiveTheme() === 'dark' ? 'light' : 'dark';
        this.applyTheme();
    }

    private bindSystemTheme(): void {
        if (this.theme !== 'auto') return;
        this.systemMQ = window.matchMedia('(prefers-color-scheme: dark)');
        this.systemListener = () => this.applyTheme();
        if (this.systemMQ.addEventListener) this.systemMQ.addEventListener('change', this.systemListener);
        else this.systemMQ.addListener(this.systemListener);
    }

    private syncHiddenInput(): void {
        if (this.hiddenInput) this.hiddenInput.value = this.markdown;
    }

    getValue(): string {
        return this.markdown;
    }

    setValue(md: string): void {
        this.markdown = String(md ?? '');
        if (this.iframeReady) {
            this.post({ type: 'me-set-value', value: this.markdown });
        }
        this.syncHiddenInput();
        this.schedulePreview();
    }

    setTheme(theme: MarkdownEditorTheme): void {
        this.theme = theme;
        this.applyTheme();
    }

    setName(name: string): void {
        this.fieldName = name;
        if (this.hiddenInput) {
            if (name) this.hiddenInput.name = name;
            else this.hiddenInput.removeAttribute('name');
        }
    }

    focus(): void {
        this.iframe?.focus();
    }

    destroy(): void {
        this.destroyed = true;
        if (this.previewTimer !== null) clearTimeout(this.previewTimer);
        if (this.systemMQ && this.systemListener) {
            if (this.systemMQ.removeEventListener) this.systemMQ.removeEventListener('change', this.systemListener);
            else this.systemMQ.removeListener(this.systemListener);
        }
        if (this.copyHandler) {
            this.previewEl.removeEventListener('click', this.copyHandler);
            this.copyHandler = null;
        }
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = null;
        }
        this.shadow.innerHTML = '';
    }
}

export default MarkdownEditor;