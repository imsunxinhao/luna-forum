import { MarkdownEditor } from '../editor.js';
import Toast from '../toast.js';

interface CommentComposer {
    open: () => void;
    close: () => void;
    submit: () => Promise<void>;
    getEditor: () => MarkdownEditor | null;
    setReply: (parentId: string, author: string) => void;
    clearReply: () => void;
}

function meta(name: string): string {
    return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
}

function postId(): string {
    return meta('post-id');
}

async function errorText(res: Response): Promise<string> {
    try {
        const data = await res.json() as { error?: string; message?: string };
        return data.error || data.message || `请求失败 (${res.status})`;
    } catch {
        return `请求失败 (${res.status})`;
    }
}

function attachComposer(container: HTMLElement, textarea: HTMLTextAreaElement): CommentComposer {
    const id = postId();
    let editor: MarkdownEditor | null = null;
    let hostEl: HTMLElement | null = null;
    let anchor: Comment | null = null;
    let submitting = false;

    const scope = container.closest('.lf-post-content-wrapper') ?? container.parentElement ?? document;
    const sendWrapper = scope.querySelector<HTMLElement>('.lf-comment-send-wrapper');
    const sendBtn = scope.querySelector<HTMLElement>('[data-lf-comment-send]');
    const parentInput = scope.querySelector<HTMLInputElement>('[data-lf-comment-parent]');
    const replyBar = scope.querySelector<HTMLElement>('[data-lf-reply-bar]');
    const replyName = scope.querySelector<HTMLElement>('[data-lf-reply-name]');

    const clearReply = (): void => {
        if (parentInput) parentInput.value = '';
        if (replyBar) replyBar.hidden = true;
        if (replyName) replyName.textContent = '';
    };

    const setReply = (parentId: string, author: string): void => {
        if (parentInput) parentInput.value = parentId;
        if (replyName) replyName.textContent = author ? `@${author}` : '';
        if (replyBar) replyBar.hidden = false;
    };

    const submit = async (): Promise<void> => {
        if (!id || submitting) return;
        const content = (editor ? editor.getValue() : textarea.value).trim();
        if (!content) {
            Toast.warning(meta('lf-comment-empty') || '评论内容不能为空');
            return;
        }

        submitting = true;
        if (sendBtn) sendBtn.setAttribute('disabled', '');
        try {
            const payload: { content: string; parentId?: string } = { content };
            const parentId = parentInput?.value ?? '';
            if (parentId) payload.parentId = parentId;

            const res = await fetch(`/api/v1/post/${encodeURIComponent(id)}/comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                Toast.error(await errorText(res));
                return;
            }
            window.location.reload();
        } catch (error) {
            Toast.error(`${meta('lf-comment-failed') || '评论发布失败'}：${String(error)}`);
        } finally {
            submitting = false;
            if (sendBtn) sendBtn.removeAttribute('disabled');
        }
    };

    const open = (): void => {
        if (editor) return;
        const parent = textarea.parentElement;
        if (!parent) return;

        anchor = document.createComment('comment-textarea');
        parent.insertBefore(anchor, textarea);
        parent.removeChild(textarea);

        hostEl = document.createElement('div');
        hostEl.className = 'lf-comment-editor';
        parent.insertBefore(hostEl, anchor);

        if (sendWrapper) sendWrapper.classList.add('lf-comment-send-active');

        editor = MarkdownEditor.init({
            selector: hostEl,
            value: textarea.value,
            theme: 'auto',
            height: '300px',
            onChange: (value: string) => { textarea.value = value; },
            onSubmit: () => { void submit(); }
        });
    };

    const close = (): void => {
        if (!editor) return;
        textarea.value = editor.getValue();
        editor.destroy();
        editor = null;

        if (sendWrapper) sendWrapper.classList.remove('lf-comment-send-active');

        const parent = hostEl?.parentElement ?? null;
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(textarea, anchor);
            anchor.parentNode.removeChild(anchor);
        } else if (parent) {
            parent.appendChild(textarea);
        }
        anchor = null;

        if (hostEl && hostEl.parentElement) hostEl.parentElement.removeChild(hostEl);
        hostEl = null;
    };

    textarea.addEventListener('focus', open);
    textarea.addEventListener('click', open);
    if (sendBtn) sendBtn.addEventListener('click', () => { void submit(); });

    return {
        open,
        close,
        submit,
        getEditor: () => editor,
        setReply,
        clearReply
    };
}

function bindReplyButtons(composer: CommentComposer | null): void {
    document.querySelectorAll<HTMLButtonElement>('[data-lf-comment-reply]').forEach(button => {
        if (button.dataset.lfReplyBound === '1') return;
        button.dataset.lfReplyBound = '1';
        button.addEventListener('click', () => {
            if (!composer) return;
            composer.open();
            composer.setReply(button.dataset.lfCommentReply ?? '', button.dataset.lfCommentAuthor ?? '');
            const input = document.querySelector<HTMLElement>('[data-lf-comment-input]');
            input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => composer.getEditor()?.focus(), 80);
        });
    });

    const cancel = document.querySelector<HTMLButtonElement>('[data-lf-reply-cancel]');
    if (cancel && cancel.dataset.lfReplyBound !== '1') {
        cancel.dataset.lfReplyBound = '1';
        cancel.addEventListener('click', () => composer?.clearReply());
    }
}

function beginCommentEdit(button: HTMLButtonElement): void {
    const id = button.dataset.lfCommentEdit;
    if (!id) return;
    const container = document.getElementById(`comment-${id}`);
    const body = container?.querySelector<HTMLElement>('[data-lf-comment-body]');
    if (!body || body.dataset.lfEditing === '1') return;

    const raw = body.dataset.lfCommentRaw ?? '';
    const original = body.innerHTML;
    body.dataset.lfEditing = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'lf-comment-edit';

    const textarea = document.createElement('textarea');
    textarea.className = 'lf-input-borderless lf-comment-edit-input';
    textarea.value = raw;
    textarea.rows = 5;

    const actions = document.createElement('div');
    actions.className = 'lf-comment-edit-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'lf-link-btn lf-link-btn-primary';
    save.textContent = meta('lf-save-edit') || '保存修改';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lf-link-btn';
    cancel.textContent = meta('lf-cancel') || '取消';

    actions.append(save, cancel);
    wrapper.append(textarea, actions);

    const restore = (): void => {
        body.innerHTML = original;
        delete body.dataset.lfEditing;
    };

    cancel.addEventListener('click', restore);

    save.addEventListener('click', () => {
        const content = textarea.value.trim();
        if (!content) {
            Toast.warning(meta('lf-comment-empty') || '评论内容不能为空');
            return;
        }
        save.setAttribute('disabled', '');
        void (async () => {
            try {
                const res = await fetch(`/api/v1/comment/${encodeURIComponent(id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ content })
                });
                if (!res.ok) {
                    Toast.error(await errorText(res));
                    save.removeAttribute('disabled');
                    return;
                }
                window.location.reload();
            } catch (error) {
                Toast.error(`${meta('lf-save-failed') || '保存失败'}：${String(error)}`);
                save.removeAttribute('disabled');
            }
        })();
    });

    body.replaceChildren(wrapper);
    textarea.focus();
}

function bindCommentEditButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-lf-comment-edit]').forEach(button => {
        if (button.dataset.lfEditBound === '1') return;
        button.dataset.lfEditBound = '1';
        button.addEventListener('click', () => beginCommentEdit(button));
    });
}

function bindCommentDeleteButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-lf-comment-delete]').forEach(button => {
        if (button.dataset.lfDeleteBound === '1') return;
        button.dataset.lfDeleteBound = '1';
        button.addEventListener('click', () => {
            const id = button.dataset.lfCommentDelete;
            if (!id) return;
            if (!window.confirm(meta('lf-confirm-delete-comment') || '确定要删除这条评论吗？')) return;
            void (async () => {
                try {
                    const res = await fetch(`/api/v1/comment/${encodeURIComponent(id)}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    if (!res.ok) {
                        Toast.error(await errorText(res));
                        return;
                    }
                    window.location.reload();
                } catch (error) {
                    Toast.error(`${meta('lf-delete-failed') || '删除失败'}：${String(error)}`);
                }
            })();
        });
    });
}

function bindPostDelete(): void {
    document.querySelectorAll<HTMLElement>('[data-lf-post-delete]').forEach(item => {
        if (item.dataset.lfDeleteBound === '1') return;
        item.dataset.lfDeleteBound = '1';
        item.addEventListener('click', () => {
            const id = postId();
            if (!id) return;
            if (!window.confirm(meta('lf-confirm-delete-post') || '确定要删除这篇帖子吗？')) return;
            void (async () => {
                try {
                    const res = await fetch(`/api/v1/post/${encodeURIComponent(id)}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    if (!res.ok) {
                        Toast.error(await errorText(res));
                        return;
                    }
                    window.location.href = '/';
                } catch (error) {
                    Toast.error(`${meta('lf-delete-failed') || '删除失败'}：${String(error)}`);
                }
            })();
        });
    });
}

export function mountCommentEditorInputs(root: ParentNode = document): void {
    const container = root.querySelector<HTMLElement>('[data-lf-comment-input]');
    if (!container || container.hasAttribute('data-lf-comment-input-mounted')) return;
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) return;

    container.setAttribute('data-lf-comment-input-mounted', 'true');
    const composer = attachComposer(container, textarea);
    bindReplyButtons(composer);
    bindCommentEditButtons();
    bindCommentDeleteButtons();
    bindPostDelete();
}

function init(): void {
    if (document.documentElement.dataset.lfPostViewInit === '1') return;
    document.documentElement.dataset.lfPostViewInit = '1';
    mountCommentEditorInputs(document);
    bindCommentEditButtons();
    bindCommentDeleteButtons();
    bindPostDelete();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
