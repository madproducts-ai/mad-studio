// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { MadDocument, MadNode, NodeType, PropValue, StyleProps } from '@mad/schema';
import { renderDocumentHtml } from './render';
import { RUNTIME_JS } from './runtime.js.gen';

/**
 * The runtime is what turns a deployed page from a picture into an application,
 * so it is tested the way it ships: the generated bundle, executed against the
 * exporter's own HTML. A behaviour that works here works on the deployed page.
 */

let seq = 0;
const node = (type: NodeType, props: Record<string, PropValue> = {}, children: MadNode[] = [], style: StyleProps = {}): MadNode => {
  seq += 1;
  return { id: `n_test${String(seq).padStart(4, '0')}`, type, name: type, props, style, children, source: 'ai', locked: false };
};

const pageWith = (children: MadNode[]): MadDocument => ({
  version: 1,
  designSystem: 'tailwind',
  theme: 'dark',
  root: node('page', { layout: 'app-shell' }, children),
  integrations: [],
  tables: [],
  updatedAt: new Date(0).toISOString(),
});

/** Renders the document and runs the shipped runtime over it, as a browser would. */
const mount = (doc: MadDocument): void => {
  const html = renderDocumentHtml(doc, { title: 'Test', target: 'preview', version: 1, deployedAt: new Date(0).toISOString(), deploymentId: 'dep-test', fonts: false });
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>'));
  document.body.innerHTML = body;
  new Function(RUNTIME_JS)();
};

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));
const click = (el: EventTarget): void => {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const press = (el: EventTarget, key: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
};

const aTable = (over: Record<string, PropValue> = {}) => node('table', { title: 'Accounts', columns: ['Name', 'Status', 'Amount'], rows: 6, selectable: true, ...over });

beforeEach(() => {
  seq = 0;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-mad-runtime');
});

it('announces itself so a page can be seen to be running', () => {
  mount(pageWith([node('text', { text: 'hello' })]));
  expect(document.documentElement.getAttribute('data-mad-runtime')).toBe('on');
});

describe('tables', () => {
  it('sorts a column and says which way round it is', () => {
    mount(pageWith([aTable()]));
    const before = $$('tbody tr').map((r) => r.children[1]?.textContent);
    click($('thead th:nth-child(2) .r-th-sort'));

    const after = $$('tbody tr').map((r) => r.children[1]?.textContent);
    expect($('thead th:nth-child(2)').getAttribute('aria-sort')).toBe('ascending');
    expect(after).toEqual([...before].sort());

    click($('thead th:nth-child(2) .r-th-sort'));
    expect($('thead th:nth-child(2)').getAttribute('aria-sort')).toBe('descending');
    expect($$('tbody tr').map((r) => r.children[1]?.textContent)).toEqual([...before].sort().reverse());
  });

  it('sorts money by value rather than by the digits in the string', () => {
    mount(pageWith([aTable({ columns: ['Name', 'Amount'], rows: 8 })]));
    click($('thead th:nth-child(3) .r-th-sort'));
    const amounts = $$('tbody tr').map((r) => Number((r.children[2]?.textContent ?? '').replace(/[$,]/g, '')));
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it('selects every row from the header, and reports a partial selection', () => {
    mount(pageWith([aTable()]));
    const all = $<HTMLInputElement>('input[data-role=select-all]');
    all.checked = true;
    all.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect($$<HTMLInputElement>('tbody input.r-check').every((b) => b.checked)).toBe(true);
    expect($$('tbody tr.is-selected')).toHaveLength(6);

    const one = $$<HTMLInputElement>('tbody input.r-check')[0]!;
    one.checked = false;
    one.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });
});

describe('the page filter', () => {
  it('narrows rows, keeps the count honest, and offers a way back', () => {
    mount(pageWith([node('nav', { brand: 'Acme', links: ['Overview'] }), aTable()]));
    const target = ($('tbody tr').children[1]?.textContent ?? '').slice(0, 6);

    click($('[data-action=search-toggle]'));
    const input = $<HTMLInputElement>('.r-nav-search');
    expect(input.hidden).toBe(false);
    input.value = target;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    const shown = $$('tbody tr').filter((r) => !(r as HTMLElement).hidden);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(6);
    expect($('.r-table-count').textContent).toBe(shown.length === 1 ? '1 row' : `${shown.length} rows`);

    press(input, 'Escape');
    expect(input.hidden).toBe(true);
    expect($$('tbody tr').filter((r) => (r as HTMLElement).hidden)).toHaveLength(0);
  });

  it('says so when a filter matches nothing, rather than showing an empty table', () => {
    mount(pageWith([node('nav', { brand: 'Acme', links: ['Overview'] }), aTable()]));
    click($('[data-action=search-toggle]'));
    const input = $<HTMLInputElement>('.r-nav-search');
    input.value = 'zzzznothing';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect($('.r-empty-state').hidden).toBe(false);
    expect($('.r-table-count').textContent).toBe('0 rows');
  });
});

describe('tabs', () => {
  const tabbed = () =>
    pageWith([node('tabs', { tabs: ['One', 'Two'], active: 0 }, [node('text', { text: 'first panel' }), node('text', { text: 'second panel' })])]);

  it('ships every panel and shows one at a time', () => {
    mount(tabbed());
    expect($$('[role=tabpanel]')).toHaveLength(2);
    expect($$('[role=tabpanel]').filter((p) => !(p as HTMLElement).hidden)).toHaveLength(1);
    expect(document.body.textContent).toContain('second panel');
  });

  it('switches on click and carries the tab stop with it', () => {
    mount(tabbed());
    click($$('[role=tab]')[1]!);
    expect($$('[role=tab]').map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect($$('[role=tab]').map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0']);
    expect($<HTMLElement>('[role=tabpanel]').hidden).toBe(true);
  });

  it('moves with the arrows and wraps, the way a tablist should', () => {
    mount(tabbed());
    press($$('[role=tab]')[0]!, 'ArrowRight');
    expect($$('[role=tab]')[1]!.getAttribute('aria-selected')).toBe('true');
    press($$('[role=tab]')[1]!, 'ArrowRight');
    expect($$('[role=tab]')[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('a toolbar filter', () => {
  // The planner emits a tab strip with nothing nested under it to mean "states
  // of the thing below", so it must filter rather than promise panels.
  const filtered = () =>
    pageWith([
      node('section', { title: 'Content' }, [
        node('tabs', { tabs: ['All', 'Draft', 'Published'], active: 0 }),
        aTable({ title: 'Posts', columns: ['Title', 'Status'], rows: 10, statuses: ['Draft', 'Published'] }),
      ]),
    ]);

  it('is a radio group, not a tablist promising panels it does not have', () => {
    mount(filtered());
    expect($('.r-tabs-filter .r-tablist').getAttribute('role')).toBe('radiogroup');
    expect($$('[role=tabpanel]')).toHaveLength(0);
    expect($$('[role=radio]').map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('narrows the section to the state it names, and All brings everything back', () => {
    mount(filtered());
    const total = $$('tbody tr').length;
    click($$('[role=radio]')[1]!);

    const shown = $$('tbody tr').filter((r) => !(r as HTMLElement).hidden);
    expect(shown.length).toBeLessThan(total);
    expect(shown.every((r) => (r.textContent ?? '').includes('Draft'))).toBe(true);

    click($$('[role=radio]')[0]!);
    expect($$('tbody tr').filter((r) => !(r as HTMLElement).hidden)).toHaveLength(total);
  });
});

describe('forms', () => {
  const withForm = () =>
    pageWith([
      node('form', { title: 'New account', submitLabel: 'Create' }, [
        node('input', { label: 'Name', required: true }),
        node('input', { label: 'Email', inputType: 'email', required: true }),
      ]),
    ]);

  it('refuses an empty required field and says which one', () => {
    mount(withForm());
    $('form.r-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    expect($$('[aria-invalid=true]')).toHaveLength(2);
    expect($('.r-error:not([hidden])').textContent).toContain('required');
    expect($('.r-form-status').textContent).toContain('Check');
    expect($('.r-form-status').getAttribute('data-tone')).toBe('danger');
  });

  it('rejects an address that is not one', () => {
    mount(withForm());
    const [name, email] = $$<HTMLInputElement>('input.r-input');
    name!.value = 'Ada';
    email!.value = 'not-an-address';
    $('form.r-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    expect($(`#${email!.id}-error`).textContent).toContain('name@example.com');
  });

  it('confirms a good submission and clears the errors as they are fixed', () => {
    mount(withForm());
    const [name, email] = $$<HTMLInputElement>('input.r-input');
    $('form.r-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    name!.value = 'Ada';
    name!.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(name!.getAttribute('aria-invalid')).toBeNull();

    email!.value = 'ada@example.com';
    email!.dispatchEvent(new window.Event('input', { bubbles: true }));
    $('form.r-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    expect($('.r-form-status').textContent).toBe('Saved.');
    expect($('.r-form-status').getAttribute('data-tone')).toBe('success');
  });
});

it('flips a switch and reports the new state', () => {
  mount(pageWith([node('toggle', { label: 'Email alerts', checked: false })]));
  click($('.r-switch'));
  expect($('.r-switch').getAttribute('aria-checked')).toBe('true');
  expect($('.r-toggle').classList.contains('is-on')).toBe(true);
});

describe('chat', () => {
  it('sends a reply, clears the box, and marks it as ours', () => {
    mount(pageWith([node('chat', { agentName: 'Sam' })]));
    const before = $$('.r-msg').length;
    const input = $<HTMLInputElement>('.r-chat-input');
    input.value = 'On it, checking now.';
    $('form.r-chat-composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    const messages = $$('.r-msg');
    expect(messages).toHaveLength(before + 1);
    expect(messages[messages.length - 1]!.getAttribute('data-from')).toBe('agent');
    expect($$('.r-msg-bubble').pop()!.textContent).toBe('On it, checking now.');
    expect(input.value).toBe('');
  });

  it('ignores an empty send rather than posting a blank bubble', () => {
    mount(pageWith([node('chat', {})]));
    const before = $$('.r-msg').length;
    $<HTMLInputElement>('.r-chat-input').value = '   ';
    $('form.r-chat-composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    expect($$('.r-msg')).toHaveLength(before);
  });
});

describe('the kanban board', () => {
  const board = () => pageWith([node('kanban', { columns: ['Todo', 'Doing', 'Done'], cardsPerColumn: 3 })]);

  it('moves a card between columns from the keyboard, since dragging is not always possible', () => {
    mount(board());
    const card = $('.r-kanban-card');
    const from = card.closest('.r-kanban-col') as HTMLElement;
    const counts = () => $$('.r-kanban-count').map((c) => c.textContent);
    const before = counts();

    press(card, 'ArrowRight', { ctrlKey: true });

    expect(card.closest('.r-kanban-col')).not.toBe(from);
    expect(counts()).not.toEqual(before);
    expect(Number(counts()[0])).toBe(Number(before[0]) - 1);
    expect(Number(counts()[1])).toBe(Number(before[1]) + 1);
  });

  it('will not push a card off the end of the board', () => {
    mount(board());
    const card = $('.r-kanban-card');
    press(card, 'ArrowLeft', { ctrlKey: true });
    expect(card.closest('.r-kanban-col')?.getAttribute('data-column')).toBe('Todo');
  });

  it('leaves the arrows alone without the modifier, so a screen reader can still read the card', () => {
    mount(board());
    const card = $('.r-kanban-card');
    const from = card.closest('.r-kanban-col');
    press(card, 'ArrowRight');
    expect(card.closest('.r-kanban-col')).toBe(from);
  });
});

it('hides a chart series when its legend entry is switched off', () => {
  mount(pageWith([node('chart', { kind: 'line', series: ['MRR', 'New'], points: 8, title: 'Revenue' })]));
  const legend = $$<HTMLButtonElement>('.r-legend-item');
  expect(legend).toHaveLength(2);

  click(legend[1]!);
  expect(legend[1]!.getAttribute('aria-pressed')).toBe('false');
  expect($<HTMLElement>('svg [data-series="1"]').style.display).toBe('none');

  click(legend[1]!);
  expect($<HTMLElement>('svg [data-series="1"]').style.display).toBe('');
});

describe('notifications', () => {
  it('opens, closes on Escape, and gives focus back to the button', () => {
    mount(pageWith([node('nav', { brand: 'Acme', links: ['Overview'] })]));
    const trigger = $<HTMLButtonElement>('[data-action=notifications]');
    const panel = $<HTMLElement>('.r-popover');
    expect(panel.hidden).toBe(true);

    click(trigger);
    expect(panel.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect($$('.r-popover-item').length).toBeGreaterThan(0);

    press(document, 'Escape');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });
});

it('marks the section a navigator points at as the current one', () => {
  mount(
    pageWith([
      node('nav', { brand: 'Acme', links: ['Revenue', 'Accounts'] }),
      node('section', { title: 'Revenue' }, [node('text', { text: 'a' })]),
      node('section', { title: 'Accounts' }, [node('text', { text: 'b' })]),
    ]),
  );
  click($$('.r-nav-link')[1]!);
  expect($$('.r-nav-link')[1]!.getAttribute('aria-current')).toBe('page');
  expect($$('.r-nav-link')[0]!.getAttribute('aria-current')).toBeNull();
});

it('chooses a plan and marks only that one', () => {
  mount(pageWith([node('pricing', { tiers: ['Starter', 'Growth'], highlight: 1 })]));
  click($$('[data-plan]')[0]!);
  expect($$('[data-plan]').map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  expect($$('.r-price-card.is-chosen')).toHaveLength(1);
});
