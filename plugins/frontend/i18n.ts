import i18next from 'i18next';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { IncomingHttpHeaders } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocale(locale: string): Record<string, unknown> {
    const filePath = resolve(__dirname, 'locales', `${locale}.json`);
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
}

/**
 * i18next 在查找时会把语言代码的 region 部分规范化为大写（如 zh-cn -> zh-CN），
 * 但 resources 对象的键按原样存储，因此注册时必须使用规范化后的键，
 * 否则该语言的所有翻译都会查找失败并回退到 fallback 语言。
 */
function normalizeLocaleKey(locale: string): string {
    const parts = locale.split('-');
    if (parts.length > 1) {
        parts[parts.length - 1] = parts[parts.length - 1].toUpperCase();
    }
    return parts.join('-');
}

export async function initI18n(locale: string = 'zh-cn'): Promise<void> {
    // 注册全部可用语言（而非仅当前语言），使运行期可切换到任意已安装的语言
    const resources: Record<string, { translation: Record<string, unknown> }> = {};
    for (const { code } of getAvailableLocales()) {
        // metadata 是语言元信息，不属于翻译表，注册时剔除
        const { metadata: _meta, ...translations } = loadLocale(code);
        resources[normalizeLocaleKey(code)] = { translation: translations };
    }
    await i18next.init({
        lng: locale,
        fallbackLng: 'en',
        resources
    });
}

export interface LocaleInfo {
    code: string;
    name: string;
}

let cachedLocales: LocaleInfo[] | null = null;

/**
 * 遍历 locales 目录，读取各语言文件顶部的 metadata 字段（code=语言简写、name=语言名称）。
 * metadata 缺失时回退为文件名。
 */
export function getAvailableLocales(): LocaleInfo[] {
    if (cachedLocales) return cachedLocales;
    const localesDir = resolve(__dirname, 'locales');
    if (!existsSync(localesDir)) return [];
    cachedLocales = readdirSync(localesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const fileName = f.replace('.json', '');
            const raw = loadLocale(fileName) as {
                metadata?: { code?: string; name?: string };
            };
            return {
                code: raw.metadata?.code ?? fileName,
                name: raw.metadata?.name ?? raw.metadata?.code ?? fileName
            };
        });
    return cachedLocales;
}

export function setLocale(locale: string): void {
    void i18next.changeLanguage(locale);
}

export function getLocale(): string {
    return i18next.language;
}

export function detectLocale(headers: IncomingHttpHeaders, cookies?: Record<string, string>): string {
    // 用户显式选择的 locale（由 /api/v1/locale/:locale 设置）优先于浏览器语言
    const cookieLocale = cookies?.locale;
    if (cookieLocale && getAvailableLocales().some(l => l.code === cookieLocale)) {
        return cookieLocale;
    }
    const acceptLang = headers['accept-language'];
    if (!acceptLang) return 'zh-cn';
    const first = acceptLang.split(',')[0]?.trim().toLowerCase();
    if (first?.startsWith('en')) return 'en';
    return 'zh-cn';
}

export function t(key: string, vars?: Record<string, unknown>): string {
    return i18next.t(key, vars);
}