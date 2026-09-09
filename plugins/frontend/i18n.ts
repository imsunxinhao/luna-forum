import i18next from 'i18next';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { IncomingHttpHeaders } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocale(locale: string): Record<string, string> {
    const filePath = resolve(__dirname, 'locales', `${locale}.json`);
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, string>;
}

export async function initI18n(locale: string = 'zh-cn'): Promise<void> {
    const resources: Record<string, { translation: Record<string, string> }> = {};
    resources[locale] = { translation: loadLocale(locale) };
    resources['en'] = { translation: loadLocale('en') };
    await i18next.init({
        lng: locale,
        fallbackLng: 'en',
        resources
    });
}

export function getAvailableLocales(): Array<{ code: string; name: string }> {
    const localesDir = resolve(__dirname, 'locales');
    if (!existsSync(localesDir)) return [];
    const files = readdirSync(localesDir);
    return files
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const code = f.replace('.json', '');
            return { code, name: code };
        });
}

export function setLocale(locale: string): void {
    void i18next.changeLanguage(locale);
}

export function getLocale(): string {
    return i18next.language;
}

export function detectLocale(headers: IncomingHttpHeaders): string {
    const acceptLang = headers['accept-language'];
    if (!acceptLang) return 'zh-cn';
    const first = acceptLang.split(',')[0]?.trim().toLowerCase();
    if (first?.startsWith('en')) return 'en';
    return 'zh-cn';
}

export function t(key: string, vars?: Record<string, unknown>): string {
    return i18next.t(key, vars);
}