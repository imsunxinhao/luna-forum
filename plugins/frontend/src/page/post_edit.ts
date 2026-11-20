import { MarkdownEditor } from '../editor.js';
import Toast from '../toast.js';

interface PostResponse {
    post?: { _id?: string; id?: string };
    error?: string;
    message?: string;
}

type FluentTextInput = HTMLElement & { value: string };
type FluentDropdown = HTMLElement & { value: string | null };
type FluentCheckbox = HTMLElement & { checked: boolean };

function readMessage(el: HTMLElement, key: string, fallback: string): string {
    return el.dataset[key] || fallback;
}

async function errorText(res: Response): Promise<string> {
    try {
        const data = await res.json() as { error?: string; message?: string };
        return data.error || data.message || `请求失败 (${res.status})`;
    } catch {
        return `请求失败 (${res.status})`;
    }
}

function init(): void {
    const root = document.querySelector<HTMLElement>('[data-lf-post-editor-page]');
    if (!root) return;

    const mode = root.dataset.postMode === 'edit' ? 'edit' : 'create';
    const id = root.dataset.postId ?? '';
    const titleInput = root.querySelector<FluentTextInput>('#lf-post-title');
    const contentInput = root.querySelector<HTMLTextAreaElement>('#lf-post-content');
    const tagSelect = root.querySelector<FluentDropdown>('#lf-post-tag');
    const hiddenCheckbox = root.querySelector<FluentCheckbox>('#lf-post-hidden');
    const saveButton = root.querySelector<HTMLElement>('#lf-post-save');
    const deleteButton = root.querySelector<HTMLElement>('#lf-post-delete');
    const editorHost = root.querySelector<HTMLElement>('#lf-post-editor');

    if (!titleInput || !contentInput || !tagSelect || !saveButton || !editorHost) return;

    const messages = {
        emptyTitle: readMessage(root, 'lfMsgEmptyTitle', '标题不能为空'),
        emptyContent: readMessage(root, 'lfMsgEmptyContent', '正文不能为空'),
        saveFailed: readMessage(root, 'lfMsgSaveFailed', '保存失败'),
        deleteFailed: readMessage(root, 'lfMsgDeleteFailed', '删除失败'),
        confirmDelete: readMessage(root, 'lfMsgConfirmDelete', '确定要删除这篇帖子吗？')
    };

    const editor = MarkdownEditor.init({
        selector: editorHost,
        value: contentInput.value,
        theme: 'auto',
        height: '460px',
        onChange: (value: string) => { contentInput.value = value; }
    });

    let saving = false;
    const setSaving = (value: boolean): void => {
        saving = value;
        if (value) saveButton.setAttribute('disabled', '');
        else saveButton.removeAttribute('disabled');
    };

    const save = async (): Promise<void> => {
        if (saving) return;
        const title = String(titleInput.value ?? '').trim();
        if (!title) {
            Toast.warning(messages.emptyTitle);
            titleInput.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus();
            return;
        }
        const content = editor.getValue().trim();
        if (!content) {
            Toast.warning(messages.emptyContent);
            return;
        }

        const body: Record<string, unknown> = {
            title,
            content,
            visibility: hiddenCheckbox?.checked ? 2 : 0
        };
        const tagId = tagSelect.value ?? '';
        if (mode === 'edit' || tagId) body.tagId = tagId;

        setSaving(true);
        try {
            const url = mode === 'edit'
                ? `/api/v1/post/${encodeURIComponent(id)}`
                : '/api/v1/post/create';
            const res = await fetch(url, {
                method: mode === 'edit' ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                Toast.error(await errorText(res));
                return;
            }
            const data = await res.json() as PostResponse;
            const newId = data.post?._id ?? data.post?.id ?? id;
            window.location.href = newId ? `/post/${newId}` : '/';
        } catch (error) {
            Toast.error(`${messages.saveFailed}：${String(error)}`);
        } finally {
            setSaving(false);
        }
    };

    saveButton.addEventListener('click', () => { void save(); });

    if (deleteButton && mode === 'edit') {
        deleteButton.addEventListener('click', () => {
            if (!window.confirm(messages.confirmDelete)) return;
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
                    Toast.error(`${messages.deleteFailed}：${String(error)}`);
                }
            })();
        });
    }

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void save();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
