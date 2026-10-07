document.addEventListener('click', (e) => {
  const btn = e.target.closest('.lf-code-copy');
  if (!btn) return;
  const code = decodeURIComponent(btn.dataset.code);
  navigator.clipboard.writeText(code).then(() => {
    const original = btn.textContent;
    btn.textContent = '<iconify-icon icon="fluent:checkmark-20-filled"></iconify-icon>';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
});

