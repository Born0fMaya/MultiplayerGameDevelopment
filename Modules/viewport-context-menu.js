import { SHAPES } from '/Assets/lib/editor-shapes.js';

export default {
  mount(root, api) {
    const menu = document.createElement('div');
    menu.className = 'viewport-context-menu';
    menu.setAttribute('aria-label', 'Insert shape');
    menu.hidden = true;
    document.body.append(menu);

    const close = () => { menu.hidden = true; };
    api.bus.on('viewport:context', ({ x, y, position, kind, handle }) => {
      handle();
      const actions = SHAPES.filter(({ id }) => id !== 'camera').map(({ id, label }) => ({
        label,
        run: () => api.bus.emit('part:create', { shape: id, position }),
      }));
      if (kind) actions.push({
        label: 'Object actions…',
        run: () => api.bus.emit('explorer:context', { x, y, id: kind }),
      });
      menu.replaceChildren(...actions.map(({ label, run }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => { close(); run(); });
        return button;
      }));
      menu.hidden = false;
      menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth))}px`;
      menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight))}px`;
      menu.firstElementChild?.focus({ preventScroll: true });
    });

    const outsideClick = (event) => { if (!menu.contains(event.target)) close(); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', outsideClick, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    api.bus.on('mode:changed', close);
    return () => {
      window.removeEventListener('pointerdown', outsideClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      menu.remove();
    };
  },
};
