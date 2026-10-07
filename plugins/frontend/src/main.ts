import '@fluentui/web-components/web-components.js';
import 'iconify-icon';
import 'katex/dist/katex.min.css';
import './styles/sidebar.css';
import './styles/lfstyle-v1.css';
import './scripts/lfscript-v1.js';
import './scripts/sidebar.js';
import katex from 'katex';
import { setTheme } from '@fluentui/web-components';
import { webLightTheme, webDarkTheme } from '@fluentui/tokens';

const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
setTheme(isDark ? webDarkTheme : webLightTheme);