import i18next from 'i18next';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LOCALE = 'zh-cn';
export const SUPPORTED_LOCALES = ['zh-cn', 'en'] as const;

type Locale = (typeof SUPPORTED_LOCALES)[number];

let currentLocale: Locale = DEFAULT_LOCALE;

function loadLocale(locale: string): Record<string, unknown> {
    const filePath = resolve(__dirname, 'locales', `${locale}.json`);
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
}

export async function initI18n(locale: string = DEFAULT_LOCALE): Promise<void> {
    const resources: Record<string, { translation: Record<string, unknown> }> = {};
    for (const l of SUPPORTED_LOCALES) {
        resources[l] = { translation: loadLocale(l) };
    }
    await i18next.init({
        lng: locale,
        fallbackLng: 'en',
        lowerCaseLng: true,
        resources,
        interpolation: { escapeValue: false }
    });
    currentLocale = isSupported(locale) ? locale : DEFAULT_LOCALE;
}

function isSupported(locale: string): locale is Locale {
    return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export function setLocale(locale: string): void {
    currentLocale = isSupported(locale) ? locale : DEFAULT_LOCALE;
}

export function getLocale(): string {
    return currentLocale;
}

/** 从请求头解析 Accept-Language，返回受支持的语言 */
export function detectLocale(headers?: Record<string, string | string[] | undefined>): string {
    const raw = headers?.['accept-language'];
    const acceptLanguage = Array.isArray(raw) ? raw[0] : raw;
    if (!acceptLanguage) return DEFAULT_LOCALE;

    for (const token of acceptLanguage.split(',')) {
        const lang = token.trim().split(';')[0].toLowerCase();
        if (lang.startsWith('zh')) return 'zh-cn';
        if (lang.startsWith('en')) return 'en';
    }
    return DEFAULT_LOCALE;
}

export function t(key: string, options?: Record<string, unknown>): string {
    return i18next.getFixedT(currentLocale)(key, options);
}