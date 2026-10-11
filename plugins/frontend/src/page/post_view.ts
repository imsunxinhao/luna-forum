import { MarkdownEditor } from '../editor.js';
import Toast from '../toast.js';

interface CommentEditorHandle {
    open: () => void;
    close: () => void;
    submit: () => Promise<void>;
    getEditor: () => MarkdownEditor | null;
    destroy: () => void;
}

function attach(container: HTMLElement, textarea: HTMLTextAreaElement): CommentEditorHandle {
    let editor: MarkdownEditor | null = null;
    let hostEl: HTMLElement | null = null;
    let anchor: Comment | null = null;
    let submitting = false;
    let sendBtn: HTMLElement | null = null;

    const findSendWrapper = (): HTMLElement | null => {
        const scope = container.closest('.lf-post-content-wrapper') ?? container.parentElement ?? document;
        return scope?.querySelector<HTMLElement>('.lf-comment-send-wrapper') ?? null;
    };

    const findSendButton = (): HTMLElement | null => {
        const scope = container.closest('.lf-post-content-wrapper') ?? container.parentElement ?? document;
        return scope?.querySelector<HTMLElement>('[data-lf-comment-send]') ?? null;
    };

    const submit = async (): Promise<void> => {
        if (!editor || submitting) return;
        const content = editor.getValue().trim();
        if (!content) {
            Toast.warning('内容不能为空');
            return;
        }

        const postId =
            document.querySelector<HTMLMetaElement>('meta[name="post-id"]')?.content || '';
        if (!postId) {
            Toast.error('无法确定帖子 ID');
            return;
        }

        submitting = true;
        if (sendBtn) sendBtn.setAttribute('disabled', '');

        try {
            const res = await fetch(
                `/api/v1/post/${encodeURIComponent(postId)}/comment`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ content })
                }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({} as { error?: string; message?: string }));
                Toast.error(err.error || err.message || `发布失败 (${res.status})`);
                return;
            }
            Toast.success('评论已发布');
            editor.setValue('');
            textarea.value = '';
        } catch (e) {
            Toast.error('网络错误：' + String(e));
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

        const wrapper = findSendWrapper();
        if (wrapper) wrapper.classList.add('lf-comment-send-active');

        editor = MarkdownEditor.init({
            selector: hostEl,
            value: textarea.value,
            theme: 'auto',
            height: '300px',
            onChange: (v: string) => { textarea.value = v; },
            onSubmit: submit
        });
    };

    const close = (): void => {
        if (!editor) return;
        textarea.value = editor.getValue();
        editor.destroy();
        editor = null;

        const wrapper = findSendWrapper();
        if (wrapper) wrapper.classList.remove('lf-comment-send-active');

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

    const destroy = (): void => {
        close();
        textarea.removeEventListener('focus', open);
        textarea.removeEventListener('click', open);
        if (sendBtn) sendBtn.removeEventListener('click', submit);
    };

    textarea.addEventListener('focus', open);
    textarea.addEventListener('click', open);

    sendBtn = findSendButton();
    if (sendBtn) sendBtn.addEventListener('click', submit);

    return { open, close, submit, getEditor: () => editor, destroy };
}

export function mountCommentEditorInputs(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('[data-lf-comment-input]').forEach(container => {
        if (container.hasAttribute('data-lf-comment-input-mounted')) return;
        const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
        if (!textarea) return;
        container.setAttribute('data-lf-comment-input-mounted', 'true');
        (container as { __lfCommentEditor?: CommentEditorHandle }).__lfCommentEditor =
            attach(container, textarea);
    });
}

function init(): void {
    mountCommentEditorInputs(document);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}