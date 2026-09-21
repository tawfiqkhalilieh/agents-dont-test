// Executed in every document, including frames, before application scripts.
export function installCapture({ binding, marker }) {
  if (window[marker]) return;
  window.__browserReplayCapture?.abort();
  const controller = new AbortController();
  window.__browserReplayCapture = controller;
  window[marker] = controller;
  const listen = (type, listener) => document.addEventListener(type, listener, {capture:true,signal:controller.signal});
  const selector = el => {
    const root = el.getRootNode();
    for (const attr of ['data-testid', 'id', 'name', 'aria-label']) {
      const value = el.getAttribute(attr);
      const candidate = value && `[${attr}="${CSS.escape(value)}"]`;
      if (candidate && root.querySelectorAll(candidate).length === 1) {
        return root.host ? `${selector(root.host)} >> ${candidate}` : candidate;
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const siblings = node.parentElement ? [...node.parentElement.children].filter(x => x.localName === node.localName) : [node];
      parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
      node = node.parentElement;
    }
    return (root.host ? `${selector(root.host)} >> ` : '') + parts.join(' > ');
  };
  const send = data => { if (typeof window[binding] === 'function') window[binding](data).catch(() => {}); };
  const target = event => event.composedPath().find(x => x instanceof Element);
  const secret = el => el.matches('input[type=password], [data-replay-secret]') || /password|secret|token|credit.?card|cc-number|one-time-code/i.test([el.name, el.id, el.autocomplete].join(' '));
  const value = el => secret(el) ? { secret: selector(el) } : { value: el.isContentEditable ? el.textContent : el.value };
  listen('click', event => {
    const el = target(event);
    if (!el || el.closest('select, option') || el.matches('input[type=checkbox], input[type=radio]')) return;
    if (el.matches('input[type=file]')) return send({ type: 'unsupported', reason: 'File upload requires a fixture and setInputFiles.' });
    send({ type: 'click', selector: selector(el), button: ['left', 'middle', 'right'][event.button] || 'left' });
  });
  listen('input', event => {
    const el = target(event);
    if (el?.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable]')) {
      send({ type: 'fill', selector: selector(el), ...value(el) });
    }
  });
  listen('change', event => {
    const el = target(event);
    if (el?.matches('select')) send({ type: 'select', selector: selector(el), values: [...el.selectedOptions].map(o => o.value) });
    if (el?.matches('input[type=checkbox], input[type=radio]')) send({ type: 'check', selector: selector(el), checked: el.checked });
  });
  listen('keydown', event => {
    const el = target(event);
    if (el && ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      send({ type: 'press', selector: selector(el), key: [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.key].filter(Boolean).join('+') });
    }
  });
  listen('scroll', event => {
    const el = event.target === document ? document.scrollingElement : event.target;
    if (el instanceof Element) send({ type: 'scroll', selector: selector(el), x: el.scrollLeft, y: el.scrollTop });
  });
  listen('dragstart', () => send({ type: 'unsupported', reason: 'Drag and drop requires a manual replay step.' }));
}
