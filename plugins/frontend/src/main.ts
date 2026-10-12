import '@fluentui/web-components/web-components.js';
import 'iconify-icon';
import 'katex/dist/katex.min.css';
import './styles/sidebar.css';
import './styles/lfstyle-v1.css';
import './styles/toast.css';
import './scripts/sidebar.js';
import katex from 'katex';
import { setTheme } from '@fluentui/web-components';
import { webLightTheme, webDarkTheme } from '@fluentui/tokens';
import { renderMarkdownNodes } from './markdown.js';
import { mountCommentEditorInputs } from './page/post_view.js';

const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(isDark ? webDarkTheme : webLightTheme);

function renderPageContent(): void {
    renderMarkdownNodes(document);
    mountCommentEditorInputs(document);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPageContent);
} else {
    renderPageContent();
}