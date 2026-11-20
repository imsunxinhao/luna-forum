const SIDEBAR_COLLAPSED_KEY = 'lf-sidebar-collapsed';

function readSidebarCollapsed() {
    try {
        return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

function writeSidebarCollapsed(value) {
    try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0');
    } catch {
        // localStorage may be unavailable in private mode; collapse still works for this page.
    }
}

function setActiveNav(drawer) {
    const path = location.pathname;
    let active = '';
    if (path === '/post/new') {
        active = 'new-post';
    } else if (path === '/' || path.startsWith('/post/')) {
        active = 'home';
    } else if (path.startsWith('/user/')) {
        active = 'profile';
    }

    drawer.querySelectorAll('[data-lf-nav]').forEach((item) => {
        const isActive = item.getAttribute('data-lf-nav') === active;
        item.classList.toggle('lf-active', isActive);
        if (isActive) {
            item.setAttribute('aria-current', 'page');
        } else {
            item.removeAttribute('aria-current');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-lf-drawer-target]').forEach((drawer) => {
        const drawerId = drawer.getAttribute('data-lf-drawer-target');
        const toggleButton = document.querySelector(`[data-lf-drawer-toggle="${drawerId}"]`);
        const drawerMenu = document.querySelector(`[data-lf-drawer-menu="${drawerId}"]`);
        const overlay = document.querySelector('[data-lf-drawer-overlay]') || ((el) => {
            el.className = 'lf-overlay';
            el.setAttribute('data-lf-drawer-overlay', '');
            document.body.appendChild(el);
            return el;
        })(document.createElement('div'));
        const isMobile = () => innerWidth <= 768;

        const closeDrawer = () => {
            drawer.classList.remove('lf-open');
            overlay.classList.remove('lf-show');
            if (drawerMenu) drawerMenu.setAttribute('aria-expanded', 'false');
        };

        const openDrawer = () => {
            drawer.classList.add('lf-open');
            overlay.classList.add('lf-show');
            if (drawerMenu) drawerMenu.setAttribute('aria-expanded', 'true');
        };

        const syncState = () => {
            if (isMobile()) {
                drawer.classList.add('lf-mobile');
                drawer.classList.remove('lf-collapsed');
                if (drawerMenu) drawerMenu.style.display = 'block';
                if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
            } else {
                drawer.classList.remove('lf-mobile', 'lf-open');
                overlay.classList.remove('lf-show');
                if (drawerMenu) {
                    drawerMenu.style.display = 'none';
                    drawerMenu.setAttribute('aria-expanded', 'false');
                }
                drawer.classList.toggle('lf-collapsed', readSidebarCollapsed());
                if (toggleButton) {
                    toggleButton.setAttribute('aria-expanded', String(!drawer.classList.contains('lf-collapsed')));
                }
            }
        };

        if (toggleButton) {
            toggleButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isMobile()) return;
                const collapsed = drawer.classList.toggle('lf-collapsed');
                writeSidebarCollapsed(collapsed);
                toggleButton.setAttribute('aria-expanded', String(!collapsed));
            });
        }

        if (drawerMenu) {
            drawerMenu.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (drawer.classList.contains('lf-open')) {
                    closeDrawer();
                } else {
                    openDrawer();
                }
            });
        }

        overlay.addEventListener('click', closeDrawer);

        addEventListener('resize', syncState);
        addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeDrawer();
        });

        drawer.querySelectorAll('.lf-nav-item, .lf-user-link, .lf-mini-avatar-link').forEach((link) => {
            link.addEventListener('click', () => {
                if (isMobile()) closeDrawer();
            });
        });

        document.querySelectorAll('[data-lf-logout]').forEach((item) => {
            item.addEventListener('click', (event) => {
                event.preventDefault();
                const form = document.createElement('form');
                form.method = 'post';
                form.action = '/api/v1/logout';
                form.style.display = 'none';
                const marker = document.createElement('input');
                marker.type = 'hidden';
                marker.name = '_action';
                marker.value = 'logout';
                form.appendChild(marker);
                document.body.appendChild(form);
                form.submit();
            });
        });

        setActiveNav(drawer);
        syncState();
    });
});