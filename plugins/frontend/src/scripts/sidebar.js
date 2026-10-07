document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-lf-drawer-target]').forEach((drawer) => {
        const drawer_id = drawer.getAttribute('data-lf-drawer-target');
        const toggle_button = document.querySelector(`[data-lf-drawer-toggle="${drawer_id}"]`);
        const drawer_menu = document.querySelector(`[data-lf-drawer-menu="${drawer_id}"]`);
        const overlay = document.querySelector('[data-lf-drawer-overlay]') || ((el) => {
            el.className = 'lf-overlay';
            el.setAttribute('data-lf-drawer-overlay', '');
            document.body.appendChild(el);
            return el;
        })(document.createElement('div'));
        const drawer_title = document.querySelector('[data-lf-drawer-title]');
        const is_mobile = () => innerWidth <= 768;
        const sync_state = () => {
            if (is_mobile()) {
                drawer.classList.add('lf-mobile');
                drawer.classList.remove('lf-collapsed');
                if (drawer_menu) {
                    drawer_menu.style.display = 'block';
                }
            } else {
                drawer.classList.remove('lf-mobile', 'lf-open');
                overlay.classList.remove('lf-show');
                if (drawer_menu) {
                    drawer_menu.style.display = 'none';
                }
            }
        };

        if (toggle_button) {
            toggle_button.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!is_mobile()) {
                    drawer.classList.toggle('lf-collapsed');
                }
            };
        }

        if (drawer_menu) {
            drawer_menu.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                drawer.classList.toggle('lf-open');
                overlay.classList.toggle('lf-show');
            };
        }

        overlay.onclick = () => {
            drawer.classList.remove('lf-open');
            overlay.classList.remove('lf-show');
        };

        addEventListener('resize', sync_state);
        addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                drawer.classList.remove('lf-open');
                overlay.classList.remove('lf-show');
            }
        });

        drawer.querySelectorAll('.lf-nav-item').forEach((nav_item) => {
            nav_item.onclick = () => {
                drawer.querySelectorAll('.lf-nav-item').forEach((item) => item.classList.remove('lf-active'));
                nav_item.classList.add('lf-active');
                if (drawer_title) {
                    drawer_title.textContent = nav_item.dataset.title || '';
                }
                if (is_mobile()) {
                    drawer.classList.remove('lf-open');
                    overlay.classList.remove('lf-show');
                }
            };
        });

        sync_state();
    });
});

function callDrawerAfterLoading(str) {
    document.querySelectorAll('.lf-nav-item').forEach(n => {
        const title = n.getAttribute('data-title');
        if(title === str) {
            n.classList.add('lf-active');
        }
    });
}