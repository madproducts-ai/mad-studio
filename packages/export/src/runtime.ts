/**
 * Behaviour for a deployed MAD Studio page.
 *
 * The exporter emits real controls; this gives them what a person expects when
 * they click. It is compiled by scripts/build-runtime.mjs into an IIFE string
 * (runtime.js.gen.ts) and inlined into every exported page, so a deployed app
 * has no network dependency and works from the file system.
 *
 * Rules it follows:
 *  - Never throw. Each feature is initialised inside its own guard, so a
 *    surprise in one widget cannot take the rest of the page down with it.
 *  - Change only what the user acted on. No global re-render, no framework.
 *  - Keyboard parity. Anything the mouse can do has a key that does it too,
 *    including moving a kanban card, which is otherwise drag-only.
 *  - Respect prefers-reduced-motion for scrolling and transitions.
 */

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.prototype.slice.call(root.querySelectorAll<T>(sel));
const byId = (id: string | null): HTMLElement | null => (id ? document.getElementById(id) : null);
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/* Transient feedback                                                   */
/* ------------------------------------------------------------------ */

let toastHost: HTMLElement | null = null;

/** A short confirmation, announced politely so it is not only a visual effect. */
const toast = (message: string): void => {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'r-toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    // Inside the frame, because every colour and font token is defined there.
    ($('.r-frame') ?? document.body).appendChild(toastHost);
  }
  const item = document.createElement('div');
  item.className = 'r-toast';
  item.textContent = message;
  toastHost.appendChild(item);
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 240);
  }, 2600);
};

/* ------------------------------------------------------------------ */
/* Navigation: nav links and sidebar items move to a section            */
/* ------------------------------------------------------------------ */

interface SectionRef {
  el: HTMLElement;
  title: string;
}

const sections = (): SectionRef[] => $$<HTMLElement>('.r-section[data-section]').map((el) => ({ el, title: el.getAttribute('data-section') ?? '' }));

/**
 * Pairs a navigator item with a section: an exact title match first, then a
 * word the two share, then position. Clamping the fallback means every item
 * goes somewhere, which matters because a generated app usually names more
 * destinations than it builds sections for.
 */
const targetFor = (label: string, index: number, all: SectionRef[]): HTMLElement | null => {
  if (all.length === 0) return null;
  const want = norm(label);
  const exact = all.find((s) => norm(s.title) === want);
  if (exact) return exact.el;
  const words = want.split(' ').filter((w) => w.length > 3);
  const overlap = all.find((s) => words.some((w) => norm(s.title).indexOf(w) >= 0));
  if (overlap) return overlap.el;
  return (all[Math.min(index, all.length - 1)] as SectionRef).el;
};

const initNav = (): void => {
  const all = sections();
  const items = $$<HTMLElement>('.r-nav-link[data-nav], .r-sidebar-item[data-nav]');
  if (items.length === 0) return;
  const targets = new Map<HTMLElement, HTMLElement>();

  items.forEach((item, i) => {
    const target = targetFor(item.getAttribute('data-nav') ?? '', i, all);
    if (target) targets.set(item, target);
    item.addEventListener('click', () => {
      const to = targets.get(item);
      if (!to) return;
      mark(item);
      if (typeof to.scrollIntoView === 'function') to.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      // Send focus with the eye, or a keyboard user lands nowhere.
      const heading = $<HTMLElement>('.r-section-title', to) ?? to;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    });
  });

  /** One current item per navigator, in both the class the CSS reads and the attribute a screen reader reads. */
  const mark = (current: HTMLElement): void => {
    const group = current.classList.contains('r-nav-link') ? '.r-nav-link[data-nav]' : '.r-sidebar-item[data-nav]';
    $$<HTMLElement>(group).forEach((el) => {
      const on = el === current;
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    // Keep the other navigator in step, so the two never disagree about where you are.
    const label = norm(current.getAttribute('data-nav') ?? '');
    const other = current.classList.contains('r-nav-link') ? '.r-sidebar-item[data-nav]' : '.r-nav-link[data-nav]';
    $$<HTMLElement>(other).forEach((el) => {
      const on = norm(el.getAttribute('data-nav') ?? '') === label;
      el.classList.toggle('is-active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  };

  // A scroll spy, so the navigator tells the truth when the user scrolls instead of clicking.
  if (all.length > 0 && typeof IntersectionObserver === 'function') {
    const byEl = new Map<HTMLElement, HTMLElement[]>();
    targets.forEach((target, item) => byEl.set(target, (byEl.get(target) ?? []).concat([item])));
    const spy = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const owners = byEl.get(visible.target as HTMLElement);
        if (owners && owners[0]) mark(owners[0]);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5] },
    );
    all.forEach((s) => spy.observe(s.el));
  }
};

/* ------------------------------------------------------------------ */
/* Tabs                                                                 */
/* ------------------------------------------------------------------ */

const initTabs = (): void => {
  $$<HTMLElement>('.r-tablist').forEach((tablist) => {
    const tabs = $$<HTMLButtonElement>('[role=tab]', tablist);
    if (tabs.length === 0) return;
    const root = tablist.parentElement;

    const select = (index: number, focus: boolean): void => {
      tabs.forEach((tab, i) => {
        const on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
        tab.classList.toggle('is-active', on);
        const panel = byId(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tabs[index]?.focus();
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(i, false));
      tab.addEventListener('keydown', (event) => {
        const keys: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
        const next = keys[event.key];
        if (next === undefined) return;
        event.preventDefault();
        // Tabs wrap, which is what the tab pattern asks for.
        select((next + tabs.length) % tabs.length, true);
      });
    });
  });
};

/* ------------------------------------------------------------------ */
/* Tables: sort, select, and a live count                               */
/* ------------------------------------------------------------------ */

/** Numbers, currency and dates should not sort as text. */
const sortValue = (cell: HTMLElement): number | string => {
  const raw = text(cell);
  const numeric = raw.replace(/[$,%\s]/g, '');
  if (numeric !== '' && !Number.isNaN(Number(numeric))) return Number(numeric);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return date;
  return raw.toLowerCase();
};

const visibleRows = (tbody: HTMLElement): HTMLElement[] => $$<HTMLElement>('tr', tbody).filter((r) => !r.hidden);

const updateCount = (wrap: HTMLElement): void => {
  const tbody = $<HTMLElement>('tbody', wrap);
  const count = $<HTMLElement>('.r-table-count', wrap);
  const empty = $<HTMLElement>('.r-empty-state', wrap);
  if (!tbody) return;
  const n = visibleRows(tbody).length;
  if (count) count.textContent = n === 1 ? '1 row' : n + ' rows';
  if (empty) empty.hidden = n > 0;
};

const initTables = (): void => {
  $$<HTMLElement>('.r-table-wrap').forEach((wrap) => {
    const table = $<HTMLTableElement>('table.r-table', wrap);
    const tbody = table ? $<HTMLElement>('tbody', table) : null;
    if (!table || !tbody) return;
    const headers = $$<HTMLElement>('thead th', table);

    headers.forEach((th, index) => {
      const button = $<HTMLButtonElement>('.r-th-sort', th);
      if (!button) return;
      button.addEventListener('click', () => {
        const ascending = th.getAttribute('aria-sort') !== 'ascending';
        headers.forEach((other) => {
          if (other.getAttribute('aria-sort')) other.setAttribute('aria-sort', 'none');
        });
        th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
        const rows = $$<HTMLElement>('tr', tbody);
        rows
          .slice()
          .sort((a, b) => {
            const av = sortValue(a.children[index] as HTMLElement);
            const bv = sortValue(b.children[index] as HTMLElement);
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return ascending ? cmp : -cmp;
          })
          .forEach((row) => tbody.appendChild(row));
      });
    });

    const all = $<HTMLInputElement>('input[data-role=select-all]', table);
    const boxes = $$<HTMLInputElement>('tbody input.r-check', table);
    const syncAll = (): void => {
      if (!all) return;
      const on = boxes.filter((b) => b.checked && !(b.closest('tr') as HTMLElement).hidden);
      const shown = boxes.filter((b) => !(b.closest('tr') as HTMLElement).hidden);
      all.checked = shown.length > 0 && on.length === shown.length;
      all.indeterminate = on.length > 0 && on.length < shown.length;
    };
    boxes.forEach((box) => {
      box.addEventListener('change', () => {
        (box.closest('tr') as HTMLElement | null)?.classList.toggle('is-selected', box.checked);
        syncAll();
      });
    });
    all?.addEventListener('change', () => {
      boxes.forEach((box) => {
        if ((box.closest('tr') as HTMLElement).hidden) return;
        box.checked = all.checked;
        (box.closest('tr') as HTMLElement).classList.toggle('is-selected', box.checked);
      });
      all.indeterminate = false;
    });

    updateCount(wrap);
  });
};

/* ------------------------------------------------------------------ */
/* Page filter: one box narrows every table and board                   */
/* ------------------------------------------------------------------ */

/**
 * Narrows the tables and boards under `root` to rows containing `query`.
 * Two callers share it: the page-wide search box, and a toolbar filter that
 * scopes itself to its own section.
 */
const narrow = (root: ParentNode, query: string): void => {
  const q = query.trim().toLowerCase();
  $$<HTMLElement>('.r-table-wrap', root).forEach((wrap) => {
    const tbody = $<HTMLElement>('tbody', wrap);
    if (!tbody) return;
    $$<HTMLElement>('tr', tbody).forEach((row) => {
      row.hidden = q !== '' && text(row).toLowerCase().indexOf(q) < 0;
    });
    updateCount(wrap);
  });
  $$<HTMLElement>('.r-kanban', root).forEach((board) => {
    $$<HTMLElement>('.r-kanban-col', board).forEach((col) => {
      $$<HTMLElement>('.r-kanban-cards > li', col).forEach((li) => {
        li.hidden = q !== '' && text(li).toLowerCase().indexOf(q) < 0;
      });
      countColumn(col);
    });
  });
};

const applyFilter = (query: string): void => narrow(document, query);

/** "All" and its synonyms mean no filter rather than a search for the word. */
const isEverything = (label: string): boolean => /^(all|everything|any)\b/.test(norm(label));

const initFilterTabs = (): void => {
  $$<HTMLElement>('.r-tabs-filter .r-tablist[role=radiogroup]').forEach((group) => {
    const options = $$<HTMLButtonElement>('[role=radio]', group);
    const scope = (group.closest('.r-section') as ParentNode | null) ?? document;

    const choose = (index: number, focus: boolean): void => {
      options.forEach((option, i) => {
        const on = i === index;
        option.setAttribute('aria-checked', on ? 'true' : 'false');
        option.setAttribute('tabindex', on ? '0' : '-1');
        option.classList.toggle('is-active', on);
      });
      const label = options[index]?.getAttribute('data-filter') ?? '';
      narrow(scope, isEverything(label) ? '' : label);
      if (focus) options[index]?.focus();
    };

    options.forEach((option, i) => {
      option.addEventListener('click', () => choose(i, false));
      option.addEventListener('keydown', (event) => {
        const keys: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: options.length - 1 };
        const next = keys[event.key];
        if (next === undefined) return;
        event.preventDefault();
        choose((next + options.length) % options.length, true);
      });
    });
  });
};

const initFilter = (): void => {
  const input = $<HTMLInputElement>('.r-nav-search');
  const toggle = $<HTMLButtonElement>('[data-action=search-toggle]');
  if (!input || !toggle) return;
  toggle.addEventListener('click', () => {
    const open = input.hidden;
    input.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) input.focus();
    else {
      input.value = '';
      applyFilter('');
    }
  });
  input.addEventListener('input', () => applyFilter(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    input.value = '';
    applyFilter('');
    input.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  });
};

/* ------------------------------------------------------------------ */
/* Forms                                                                */
/* ------------------------------------------------------------------ */

const fieldError = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): HTMLElement | null => byId(control.id ? control.id + '-error' : null);

const showError = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, message: string): void => {
  const slot = fieldError(control);
  control.setAttribute('aria-invalid', 'true');
  if (!slot) return;
  slot.textContent = message;
  slot.hidden = false;
};

const clearError = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void => {
  const slot = fieldError(control);
  control.removeAttribute('aria-invalid');
  if (!slot) return;
  slot.textContent = '';
  slot.hidden = true;
};

const initForms = (): void => {
  $$<HTMLFormElement>('form.r-form').forEach((form) => {
    const status = $<HTMLElement>('.r-form-status', form);
    const controls = $$<HTMLInputElement>('input.r-input, select.r-input, textarea.r-input', form);

    controls.forEach((control) => {
      // Validate when the user leaves a field, not on every keystroke.
      control.addEventListener('blur', () => {
        if (control.value.trim() !== '' || !control.required) clearError(control);
      });
      control.addEventListener('input', () => clearError(control));
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      let firstBad: HTMLElement | null = null;
      controls.forEach((control) => {
        clearError(control);
        if (control.required && control.value.trim() === '') {
          showError(control, 'This field is required.');
          firstBad = firstBad ?? control;
        } else if (control.type === 'email' && control.value.trim() !== '' && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(control.value)) {
          showError(control, 'Enter an email address like name@example.com.');
          firstBad = firstBad ?? control;
        }
      });
      if (firstBad) {
        if (status) {
          status.textContent = 'Check the highlighted fields.';
          status.setAttribute('data-tone', 'danger');
        }
        (firstBad as HTMLElement).focus();
        return;
      }
      if (status) {
        status.textContent = 'Saved.';
        status.setAttribute('data-tone', 'success');
      }
      toast('Saved');
    });

    form.addEventListener('reset', () => {
      controls.forEach(clearError);
      if (!status) return;
      status.textContent = '';
      status.removeAttribute('data-tone');
    });
  });
};

/* ------------------------------------------------------------------ */
/* Switches                                                             */
/* ------------------------------------------------------------------ */

const initToggles = (): void => {
  $$<HTMLButtonElement>('.r-switch[role=switch]').forEach((sw) => {
    sw.addEventListener('click', () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      sw.closest('.r-toggle')?.classList.toggle('is-on', on);
    });
  });
};

/* ------------------------------------------------------------------ */
/* Chat                                                                 */
/* ------------------------------------------------------------------ */

const initChat = (): void => {
  $$<HTMLFormElement>('form.r-chat-composer').forEach((composer) => {
    const input = $<HTMLInputElement>('.r-chat-input', composer);
    const chat = composer.closest('.r-chat');
    const body = chat ? $<HTMLElement>('.r-chat-body', chat) : null;
    if (!input || !body) return;
    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (value === '') return;
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const message = document.createElement('div');
      message.className = 'r-msg';
      message.setAttribute('data-from', 'agent');
      const bubble = document.createElement('span');
      bubble.className = 'r-msg-bubble';
      bubble.textContent = value;
      const meta = document.createElement('span');
      meta.className = 'r-msg-meta';
      meta.textContent = 'You ' + time;
      message.appendChild(bubble);
      message.appendChild(meta);
      body.appendChild(message);
      body.scrollTop = body.scrollHeight;
      input.value = '';
      input.focus();
    });
  });
};

/* ------------------------------------------------------------------ */
/* Kanban: drag with a pointer, or move with the keyboard               */
/* ------------------------------------------------------------------ */

const countColumn = (col: HTMLElement): void => {
  const badge = $<HTMLElement>('.r-kanban-count', col);
  if (badge) badge.textContent = String($$<HTMLElement>('.r-kanban-cards > li', col).filter((li) => !li.hidden).length);
};

const moveCard = (card: HTMLElement, delta: number): void => {
  const board = card.closest('.r-kanban');
  const from = card.closest('.r-kanban-col') as HTMLElement | null;
  if (!board || !from) return;
  const cols = $$<HTMLElement>('.r-kanban-col', board);
  const to = cols[cols.indexOf(from) + delta];
  const listItem = card.closest('li');
  const list = to ? $<HTMLElement>('.r-kanban-cards', to) : null;
  if (!to || !list || !listItem) return;
  list.appendChild(listItem);
  countColumn(from);
  countColumn(to);
  card.focus();
  toast(text($<HTMLElement>('.r-kanban-title', card)) + ' moved to ' + (to.getAttribute('data-column') ?? 'the next column'));
};

const initKanban = (): void => {
  let dragging: HTMLElement | null = null;

  $$<HTMLElement>('.r-kanban-card').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      dragging = card;
      card.classList.add('is-dragging');
      (event as DragEvent).dataTransfer?.setData('text/plain', text($<HTMLElement>('.r-kanban-title', card)));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      dragging = null;
    });
    // The single-pointer alternative to dragging, which WCAG asks for.
    card.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (!(event as KeyboardEvent).ctrlKey || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return;
      event.preventDefault();
      moveCard(card, key === 'ArrowRight' ? 1 : -1);
    });
  });

  $$<HTMLElement>('.r-kanban-col').forEach((col) => {
    const list = $<HTMLElement>('.r-kanban-cards', col);
    if (!list) return;
    col.addEventListener('dragover', (event) => {
      if (!dragging) return;
      event.preventDefault();
      col.classList.add('is-drop-target');
    });
    col.addEventListener('dragleave', () => col.classList.remove('is-drop-target'));
    col.addEventListener('drop', (event) => {
      event.preventDefault();
      col.classList.remove('is-drop-target');
      if (!dragging) return;
      const from = dragging.closest('.r-kanban-col') as HTMLElement | null;
      const listItem = dragging.closest('li');
      if (!listItem) return;
      list.appendChild(listItem);
      if (from) countColumn(from);
      countColumn(col);
    });
    countColumn(col);
  });
};

/* ------------------------------------------------------------------ */
/* Charts: a legend that hides its series                               */
/* ------------------------------------------------------------------ */

const initCharts = (): void => {
  $$<HTMLElement>('.r-chart-svg').forEach((chart) => {
    const svg = $<SVGElement>('svg', chart);
    if (!svg) return;
    $$<HTMLButtonElement>('.r-legend-item', chart).forEach((item) => {
      item.addEventListener('click', () => {
        const on = item.getAttribute('aria-pressed') !== 'true';
        item.setAttribute('aria-pressed', on ? 'true' : 'false');
        item.classList.toggle('is-off', !on);
        const series = item.getAttribute('data-series');
        $$<SVGElement>('[data-series="' + series + '"]', svg).forEach((node) => {
          node.style.display = on ? '' : 'none';
        });
      });
    });
  });
};

/* ------------------------------------------------------------------ */
/* Pricing                                                              */
/* ------------------------------------------------------------------ */

const initPricing = (): void => {
  $$<HTMLElement>('.r-pricing').forEach((group) => {
    const choices = $$<HTMLButtonElement>('[data-plan]', group);
    choices.forEach((choice) => {
      choice.addEventListener('click', () => {
        choices.forEach((other) => {
          other.setAttribute('aria-checked', other === choice ? 'true' : 'false');
          other.closest('.r-price-card')?.classList.toggle('is-chosen', other === choice);
        });
        toast(choice.getAttribute('data-plan') + ' selected');
      });
    });
  });
};

/* ------------------------------------------------------------------ */
/* Popovers                                                             */
/* ------------------------------------------------------------------ */

const initPopovers = (): void => {
  const triggers = $$<HTMLButtonElement>('[data-action=notifications]');
  triggers.forEach((trigger) => {
    const panel = byId(trigger.getAttribute('aria-controls'));
    if (!panel) return;
    const close = (focus: boolean): void => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus();
    };
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target as Node) || trigger.contains(event.target as Node)) return;
      close(false);
    });
    document.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && !panel.hidden) close(true);
    });
  });
};

/* ------------------------------------------------------------------ */
/* Everything else that is a button                                     */
/* ------------------------------------------------------------------ */

/** Rows of a table as CSV, so an Export button exports something real. */
const tableCsv = (wrap: HTMLElement): string => {
  const quote = (value: string): string => '"' + value.replace(/"/g, '""') + '"';
  const rows: string[] = [];
  const head = $$<HTMLElement>('thead th', wrap)
    .map((th) => text($<HTMLElement>('.r-th-sort', th) ?? th))
    .filter((h) => h !== '');
  rows.push(head.map(quote).join(','));
  const tbody = $<HTMLElement>('tbody', wrap);
  if (tbody) {
    visibleRows(tbody).forEach((tr) => {
      const cells = $$<HTMLElement>('td', tr)
        .filter((td) => !td.classList.contains('r-th-check'))
        .map((td) => text(td));
      rows.push(cells.map(quote).join(','));
    });
  }
  return rows.join('\r\n');
};

const download = (name: string, content: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Buttons the other features do not already own. An export downloads the table
 * it sits with; an add appends to the nearest board; a filter opens the page
 * filter. Anything else confirms that it was pressed, which is the honest
 * answer for a generated demo and still beats a control that does nothing.
 */
const initButtons = (): void => {
  $$<HTMLButtonElement>('button.r-btn').forEach((button) => {
    if (button.type === 'submit' || button.type === 'reset') return;
    if (button.hasAttribute('data-plan')) return;
    const label = text(button);
    const verb = norm(label);

    button.addEventListener('click', () => {
      const section = button.closest('.r-section') ?? document;

      if (/export|download|csv/.test(verb)) {
        const wrap = $<HTMLElement>('.r-table-wrap', section) ?? $<HTMLElement>('.r-table-wrap');
        if (wrap) {
          download((text($<HTMLElement>('.r-card-title', wrap)) || 'table').replace(/\s+/g, '-').toLowerCase() + '.csv', tableCsv(wrap));
          toast('Exported ' + text($<HTMLElement>('.r-table-count', wrap)));
          return;
        }
      }

      if (/^(add|new|create)\b/.test(verb)) {
        const board = $<HTMLElement>('.r-kanban', section) ?? $<HTMLElement>('.r-kanban');
        const firstColumn = board ? $<HTMLElement>('.r-kanban-col', board) : null;
        const list = firstColumn ? $<HTMLElement>('.r-kanban-cards', firstColumn) : null;
        const template = list ? $<HTMLElement>('li', list) : null;
        if (list && template && firstColumn) {
          const copy = template.cloneNode(true) as HTMLElement;
          const title = $<HTMLElement>('.r-kanban-title', copy);
          if (title) title.textContent = 'New item';
          const card = $<HTMLElement>('.r-kanban-card', copy);
          list.insertBefore(copy, list.firstChild);
          countColumn(firstColumn);
          bindCard(card);
          card?.focus();
          toast('Card added');
          return;
        }
      }

      if (/filter|search/.test(verb)) {
        const toggle = $<HTMLButtonElement>('[data-action=search-toggle]');
        if (toggle) {
          toggle.click();
          return;
        }
      }

      toast(label);
    });
  });

  $$<HTMLButtonElement>('.r-icon-btn').forEach((button) => {
    if (button.hasAttribute('data-action')) return;
    button.addEventListener('click', () => toast(button.getAttribute('aria-label') ?? 'Done'));
  });
};

/** Cards created after load need the same handlers the rendered ones got. */
const bindCard = (card: HTMLElement | null): void => {
  if (!card) return;
  card.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (!(event as KeyboardEvent).ctrlKey || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return;
    event.preventDefault();
    moveCard(card, key === 'ArrowRight' ? 1 : -1);
  });
};

/* ------------------------------------------------------------------ */

const features: Array<[string, () => void]> = [
  ['nav', initNav],
  ['tabs', initTabs],
  ['tables', initTables],
  ['filter', initFilter],
  ['filter-tabs', initFilterTabs],
  ['forms', initForms],
  ['toggles', initToggles],
  ['chat', initChat],
  ['kanban', initKanban],
  ['charts', initCharts],
  ['pricing', initPricing],
  ['popovers', initPopovers],
  ['buttons', initButtons],
];

const start = (): void => {
  document.documentElement.setAttribute('data-mad-runtime', 'on');
  features.forEach(([name, init]) => {
    try {
      init();
    } catch (error) {
      // One broken widget must not cost the page every other behaviour.
      if (typeof console !== 'undefined') console.error('[mad] ' + name + ' failed to start', error);
    }
  });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
