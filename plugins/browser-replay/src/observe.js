// Runs in the target document. Limit evidence size and omit credential controls.
export function snapshotDOM() {
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const text = value => (value || '').replace(/\s+/g,' ').trim().slice(0,300);
  const selector = el => {
    for (const attr of ['data-testid','id','name']) {
      const value = el.getAttribute(attr);
      if (value) {
        const css = `[${attr}="${CSS.escape(value)}"]`;
        if (document.querySelectorAll(css).length === 1) return css;
      }
    }
    return null;
  };
  return [...document.querySelectorAll('[data-testid], [role=alert], [role=status], .alert, dialog, ul, ol, table, input, textarea, select, h1, h2')].slice(0,100).map(el => {
    const row = {tag:el.localName,selector:selector(el),role:el.getAttribute('role'),visible:visible(el)};
    if (el.matches('input, textarea, select')) {
      const sensitive = el.matches('input[type=password], [data-replay-secret]') || /password|secret|token|credit.?card|cc-number|one-time-code/i.test([el.name,el.id,el.autocomplete].join(' '));
      row.value = sensitive ? '[REDACTED]' : String(el.value).slice(0,300);
    } else {
      row.text = visible(el) ? text(el.innerText) : '';
    }
    if (el.matches('ul, ol, table')) {
      const items = [...el.querySelectorAll(el.localName === 'table' ? 'tbody tr' : ':scope > li')];
      row.count = items.length;
      row.items = items.slice(0,20).map(item => ({text:text(item.innerText),visible:visible(item)}));
    }
    return row;
  });
}
