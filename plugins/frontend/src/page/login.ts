import Toast from '../toast.js';

function init(): void {
    const root = document.querySelector<HTMLElement>('.lf-card-center-wrapper');
    if (!root) return;

    const error = root.dataset.lfError || '';
    const success = root.dataset.lfSuccess || '';

    if (error) {
        Toast.error(error, { duration: 6000 });
    }
    if (success) {
        Toast.success(success, { duration: 4000 });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}