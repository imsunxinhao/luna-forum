/**
 * Email templates for transactional mails (registration confirmation and
 * password reset). This is the single place to edit those mails.
 *
 * Placeholders you can use inside the strings below:
 *   {{site}}     the configured site name
 *   {{username}} the account being registered (registration mail only)
 *   {{link}}     the auto-generated verification / reset link
 * The {{link}} placeholder is inserted automatically; you do NOT need to add
 * the raw URL yourself.
 *
 * To change a mail, edit the strings here, then rebuild and restart:
 *   npx tsc ; npx tscp
 *   (and restart the server process)
 */

export type MailLang = 'zh' | 'en'

export interface MailTemplate {
    /** Registration mail subject. {{site}} is replaced with the site name. */
    registerSubject: string
    /** Password-reset mail subject. {{site}} is replaced with the site name. */
    resetSubject: string
    /** Registration intro paragraph. {{site}} and {{username}} are replaced. */
    registerIntro: string
    /** Password-reset intro paragraph. {{site}} is replaced. */
    resetIntro: string
    /** Label shown on the button / link. */
    linkLabel: string
    /** Footer hint line. */
    linkHint: string
}

export const MAIL_TEMPLATES: Record<MailLang, MailTemplate> = {
    zh: {
        registerSubject: '{{site}} · 注册确认',
        resetSubject: '{{site}} · 重置密码',
        registerIntro: '你正在注册 {{site}} 的账号「{{username}}」，请在 24 小时内点击下面的链接完成注册：',
        resetIntro: '我们收到了重置 {{site}} 账号密码的请求，请在 1 小时内点击下面的链接设置新密码：',
        linkLabel: '打开链接',
        linkHint: '如果不是你本人操作，请忽略本邮件。'
    },
    en: {
        registerSubject: '{{site}} · Confirm your registration',
        resetSubject: '{{site}} · Reset your password',
        registerIntro: 'You are registering the account "{{username}}" on {{site}}. Open the link below within 24 hours to finish:',
        resetIntro: 'We received a request to reset your {{site}} password. Open the link below within 1 hour to choose a new one:',
        linkLabel: 'Open link',
        linkHint: 'If you did not request this, just ignore this email.'
    }
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** Build the HTML body from an intro, link, button label and hint. */
export function mailHtml(intro: string, link: string, label: string, hint: string): string {
    return [
        '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1b1b1b">',
        `<p>${escapeHtml(intro)}</p>`,
        `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#4f6bed;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(label)}</a></p>`,
        `<p style="color:#6b6b6b;font-size:13px;word-break:break-all">${escapeHtml(link)}</p>`,
        `<p style="color:#6b6b6b;font-size:13px">${escapeHtml(hint)}</p>`,
        '</div>'
    ].join('')
}

function fill(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match)
}

export interface RenderedMail {
    subject: string
    text: string
    html: string
}

/** Render the registration-confirmation mail for a language. */
export function renderRegisterMail(
    lang: MailLang,
    site: string,
    username: string,
    link: string
): RenderedMail {
    const t = MAIL_TEMPLATES[lang]
    const vars = { site, username, link }
    const intro = fill(t.registerIntro, vars)
    return {
        subject: fill(t.registerSubject, vars),
        text: [intro, '', link, '', fill(t.linkHint, vars)].join('\n'),
        html: mailHtml(intro, link, fill(t.linkLabel, vars), fill(t.linkHint, vars))
    }
}

/** Render the password-reset mail for a language. */
export function renderResetMail(
    lang: MailLang,
    site: string,
    link: string
): RenderedMail {
    const t = MAIL_TEMPLATES[lang]
    const vars = { site, link }
    const intro = fill(t.resetIntro, vars)
    return {
        subject: fill(t.resetSubject, vars),
        text: [intro, '', link, '', fill(t.linkHint, vars)].join('\n'),
        html: mailHtml(intro, link, fill(t.linkLabel, vars), fill(t.linkHint, vars))
    }
}
