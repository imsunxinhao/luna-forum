export type ToastType = "error" | "info" | "success" | "warning";

export interface ToastOptions {
    title?: string;
    duration?: number;
}

interface ToastElement extends HTMLDivElement {
    _duration: number;
    _translate_x: number;
    _opacity: number;
    _timeout_id: ReturnType<typeof setTimeout> | null;
    _cleanup_drag: (() => void) | null;
}

const default_duration = 4500;
const drag_close_threshold = 80;
const drag_opacity_factor = 0.005;
const exit_distance = 160;
const exit_duration = 220;

const icons: Record<string, string> = {
    error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v7h-2V7Zm0 9h2v2h-2v-2Z"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg>`,
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 13.4-4.2-4.2 1.4-1.4 2.8 2.8 6-6 1.4 1.4-7.4 7.4Z"/></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2v-4h2v4Z"/></svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3-1.41-1.41Z"/></svg>`
};

const type_map: Record<ToastType, { icon: string }> = {
    error: { icon: icons.error },
    info: { icon: icons.info },
    success: { icon: icons.success },
    warning: { icon: icons.warning }
};

interface PointerHandlers {
    on_down: (event: PointerEvent) => void;
    on_move: (event: PointerEvent) => void;
    on_up: (event: PointerEvent) => void;
    on_cancel: (event: PointerEvent) => void;
}

function bind_pointer_events(element: HTMLElement, handlers: PointerHandlers): () => void {
    element.addEventListener("pointerdown", handlers.on_down);
    element.addEventListener("pointermove", handlers.on_move);
    element.addEventListener("pointerup", handlers.on_up);
    element.addEventListener("pointercancel", handlers.on_cancel);
    return () => {
        element.removeEventListener("pointerdown", handlers.on_down);
        element.removeEventListener("pointermove", handlers.on_move);
        element.removeEventListener("pointerup", handlers.on_up);
        element.removeEventListener("pointercancel", handlers.on_cancel);
    };
}

function attach_drag_handler(toast_element: ToastElement): () => void {
    let start_x = 0;
    let current_x = 0;
    let is_dragging = false;

    const on_down = (event: PointerEvent) => {
        if (
            (event.button !== 0 && event.pointerType === "mouse") ||
            (event.target as HTMLElement).closest(".lf-toast-close") ||
            toast_element.classList.contains("lf-toast-out")
        ) return;

        is_dragging = true;

        if (toast_element._timeout_id) {
            clearTimeout(toast_element._timeout_id);
            toast_element._timeout_id = null;
        }

        toast_element.classList.add("lf-toast-animating");

        const computed_transform = window.getComputedStyle(toast_element).transform;
        let base_x = 0;
        if (computed_transform && computed_transform !== "none") {
            const match = computed_transform.match(/matrix.*\((.+)\)/);
            if (match) {
                const values = match[1].split(", ").map(parseFloat);
                base_x = values[4] || 0;
            }
        }

        current_x = Math.max(0, base_x);
        start_x = event.clientX - current_x;
        toast_element.style.transform = `translateX(${current_x}px)`;
        toast_element.classList.add("lf-toast-dragging");
        toast_element.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const on_move = (event: PointerEvent) => {
        if (!is_dragging) return;
        const delta_x = Math.max(0, event.clientX - start_x);
        current_x = delta_x;

        const opacity = Math.max(0.2, 1 - delta_x * drag_opacity_factor);
        toast_element.style.transform = `translateX(${delta_x}px)`;
        toast_element.style.opacity = String(opacity);
        toast_element._translate_x = delta_x;
        toast_element._opacity = opacity;

        event.preventDefault();
    };

    const on_up = (event: PointerEvent) => {
        if (!is_dragging) return;
        is_dragging = false;
        toast_element.classList.remove("lf-toast-dragging");
        toast_element.classList.remove("lf-toast-animating");
        try {
            toast_element.releasePointerCapture(event.pointerId);
        } catch (_) { }

        const translate_x = toast_element._translate_x || current_x || 0;
        const opacity = toast_element._opacity ?? 1;

        if (translate_x >= drag_close_threshold) {
            remove_toast(toast_element);
            return;
        }

        const bounce_back = toast_element.animate(
            [
                { transform: `translateX(${translate_x}px)`, opacity },
                { transform: "translateX(0px)", opacity: 1 }
            ],
            { duration: exit_duration, easing: "ease-out", fill: "forwards" }
        );

        bounce_back.onfinish = () => {
            toast_element.style.transform = "";
            toast_element.style.opacity = "";
            toast_element._translate_x = 0;
            toast_element._opacity = 1;

            const duration = toast_element._duration;
            if (duration > 0 && toast_element.parentNode) {
                if (toast_element._timeout_id) clearTimeout(toast_element._timeout_id);
                toast_element._timeout_id = setTimeout(() => remove_toast(toast_element), duration);
            }
        };
    };

    const on_cancel = (event: PointerEvent) => {
        if (!is_dragging) return;
        is_dragging = false;
        toast_element.classList.remove("lf-toast-dragging");
        toast_element.classList.remove("lf-toast-animating");
        try {
            toast_element.releasePointerCapture(event.pointerId);
        } catch (_) { }

        const translate_x = toast_element._translate_x || 0;
        const opacity = toast_element._opacity ?? 1;

        const bounce_back = toast_element.animate(
            [
                { transform: `translateX(${translate_x}px)`, opacity },
                { transform: "translateX(0px)", opacity: 1 }
            ],
            { duration: exit_duration, easing: "ease-out", fill: "forwards" }
        );

        bounce_back.onfinish = () => {
            toast_element.style.transform = "";
            toast_element.style.opacity = "";
            toast_element._translate_x = 0;
            toast_element._opacity = 1;

            const duration = toast_element._duration;
            if (duration > 0 && toast_element.parentNode) {
                if (toast_element._timeout_id) clearTimeout(toast_element._timeout_id);
                toast_element._timeout_id = setTimeout(() => remove_toast(toast_element), duration);
            }
        };
    };

    return bind_pointer_events(toast_element, { on_down, on_move, on_up, on_cancel });
}

function create_icon(svg_markup: string, size: number): HTMLSpanElement {
    const wrapper = document.createElement("span");
    wrapper.style.display = "inline-flex";
    wrapper.style.width = `${size}px`;
    wrapper.style.height = `${size}px`;
    wrapper.innerHTML = svg_markup;
    const svg_element = wrapper.querySelector("svg");
    if (svg_element) {
        svg_element.setAttribute("width", String(size));
        svg_element.setAttribute("height", String(size));
        svg_element.removeAttribute("fill");
        svg_element.querySelectorAll("path, circle, rect, polygon, ellipse, line, polyline").forEach((el) => {
            el.removeAttribute("fill");
            el.removeAttribute("stroke");
        });
        svg_element.style.fill = "";
    }
    return wrapper;
}

function create_toast_element(
    message: string | null | undefined,
    type: ToastType,
    title: string | null,
    duration: number
): ToastElement {
    const config = type_map[type] || type_map.info;
    const toast_element = document.createElement("div") as ToastElement;
    toast_element.className = `lf-toast-item lf-toast-${type}`;
    toast_element._duration = duration;
    toast_element._translate_x = 0;
    toast_element._opacity = 1;
    toast_element._timeout_id = null;
    toast_element._cleanup_drag = null;

    const icon_wrapper = document.createElement("div");
    icon_wrapper.className = "lf-toast-icon";
    icon_wrapper.appendChild(create_icon(config.icon, 26));

    const content_element = document.createElement("div");
    content_element.className = "lf-toast-content";

    if (title) {
        const title_element = document.createElement("div");
        title_element.className = "lf-toast-title";
        title_element.textContent = title;
        content_element.appendChild(title_element);
    }

    if (message !== undefined && message !== null && message !== "") {
        const message_element = document.createElement("div");
        message_element.className = "lf-toast-message";
        message_element.textContent = message;
        content_element.appendChild(message_element);
    }

    const close_button = document.createElement("button");
    close_button.className = "lf-toast-close";
    close_button.setAttribute("aria-label", "关闭通知");
    close_button.appendChild(create_icon(icons.close, 18));

    toast_element.appendChild(icon_wrapper);
    toast_element.appendChild(content_element);
    toast_element.appendChild(close_button);

    close_button.addEventListener("click", (event) => {
        event.stopPropagation();
        remove_toast(toast_element);
    });

    if (duration > 0) {
        toast_element._timeout_id = setTimeout(() => remove_toast(toast_element), duration);
    }

    toast_element._cleanup_drag = attach_drag_handler(toast_element);

    return toast_element;
}

function remove_toast(toast_element: ToastElement): void {
    if (!toast_element || !toast_element.parentNode || toast_element.classList.contains("lf-toast-out")) return;

    if (toast_element._timeout_id) {
        clearTimeout(toast_element._timeout_id);
        toast_element._timeout_id = null;
    }

    if (toast_element._cleanup_drag) {
        toast_element._cleanup_drag();
        toast_element._cleanup_drag = null;
    }

    const translate_x = toast_element._translate_x || 0;
    const opacity = toast_element._opacity ?? 1;

    toast_element.classList.add("lf-toast-out");
    toast_element.classList.remove("lf-toast-dragging");
    toast_element.classList.remove("lf-toast-animating");

    const animation = toast_element.animate(
        [
            { transform: `translateX(${translate_x}px)`, opacity },
            { transform: `translateX(${translate_x + exit_distance}px)`, opacity: 0 }
        ],
        { duration: exit_duration, easing: "ease-in", fill: "forwards" }
    );

    const cleanup = () => {
        if (toast_element.parentNode) toast_element.remove();
    };

    animation.onfinish = cleanup;
    setTimeout(cleanup, exit_duration + 100);
}

export function popup(type: ToastType, message?: string | null, options: ToastOptions = {}): ToastElement {
    const final_type: ToastType = type_map[type] ? type : "info";
    const title = options.title || null;
    const duration = options.duration !== undefined ? options.duration : default_duration;

    const toast_element = create_toast_element(message, final_type, title, duration);

    const container = document.getElementById("lf-toast-container");
    if (!container) throw new Error("Toast container #lf-toast-container not found");

    container.appendChild(toast_element);
    return toast_element;
}

export const Toast = {
    popup,
    error: (message?: string | null, options?: ToastOptions) => popup("error", message, options),
    info: (message?: string | null, options?: ToastOptions) => popup("info", message, options),
    success: (message?: string | null, options?: ToastOptions) => popup("success", message, options),
    warning: (message?: string | null, options?: ToastOptions) => popup("warning", message, options),
    remove: remove_toast,
    clearAll: (): void => {
        document.querySelectorAll<ToastElement>(".lf-toast-item").forEach((element) => {
            if (element._timeout_id) clearTimeout(element._timeout_id);
            if (element._cleanup_drag) element._cleanup_drag();
            element.remove();
        });
    }
};

export default Toast;