import { marked } from 'marked'
import katex from 'katex'

// KaTeX 数学公式支持：`$...$` 为行内公式，`$$...$$` 为块级公式。
const mathExtension = {
    extensions: [
        {
            name: 'mathBlock',
            level: 'block' as const,
            start(src: string) {
                return src.indexOf('$$')
            },
            tokenizer(src: string) {
                const match = /^\$\$\n?([\s\S]+?)\n?\$\$/.exec(src)
                if (match) {
                    return { type: 'mathBlock', raw: match[0], text: match[1].trim() }
                }
            },
            renderer(token: { text: string }) {
                try {
                    return `<div class="lf-katex-display">${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>`
                } catch {
                    return `<pre><code>${token.text}</code></pre>`
                }
            }
        },
        {
            name: 'mathInline',
            level: 'inline' as const,
            start(src: string) {
                return src.indexOf('$')
            },
            tokenizer(src: string) {
                const match = /^\$([^$\n]+?)\$/.exec(src)
                if (match) {
                    return { type: 'mathInline', raw: match[0], text: match[1].trim() }
                }
            },
            renderer(token: { text: string }) {
                try {
                    return katex.renderToString(token.text, { displayMode: false, throwOnError: false })
                } catch {
                    return token.text
                }
            }
        }
    ]
}

marked.use(mathExtension)

/**
 * 将 Markdown 文本渲染为 HTML（含 KaTeX 数学公式）。
 */
export function renderMarkdown(content: string): string {
    if (!content) return ''
    return marked.parse(content, { async: false, breaks: true }) as string
}
