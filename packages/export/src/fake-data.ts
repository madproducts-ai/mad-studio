/**
 * Deterministic sample data for the renderer. Everything is seeded from the
 * node id so a table keeps the same rows across re-renders, undo, and reload,
 * and two nodes never show identical data.
 */

const FIRST = ['Priya', 'Marcus', 'Elena', 'Devon', 'Aiko', 'Jordan', 'Sasha', 'Noah', 'Lena', 'Tariq', 'Mei', 'Oscar', 'Zanele', 'Ivan', 'Hana', 'Kwame'];
const LAST = ['Naidoo', 'Thompson', 'Rossi', 'Kim', 'Sato', 'Reyes', 'Okafor', 'Lindqvist', 'Mokoena', 'Petrov', 'Haddad', 'Nakamura', 'Botha', 'Fischer', 'Dube', 'Costa'];
const COMPANIES = ['Acme Corp', 'Northwind', 'Lumen Labs', 'Halcyon', 'Vertex Retail', 'Bluefin', 'Orbital', 'Kestrel Health', 'Marigold', 'Tessellate', 'Copperline', 'Fjord Systems'];
const STATUSES = ['Active', 'Trial', 'Past due', 'Churn risk', 'Paused', 'Onboarding'];
const PLANS = ['Starter', 'Growth', 'Scale', 'Enterprise'];
const STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TASKS = ['Refine onboarding copy', 'Ship SSO redirect fix', 'Design pricing page v3', 'Migrate billing webhooks', 'Audit contrast on dark theme', 'Write API changelog', 'Prototype mobile nav', 'Load-test checkout', 'Localize date pickers', 'Review retention cohort', 'Add export to CSV', 'Instrument funnel events'];
const MESSAGES_IN = ['Hi, our invoice for August looks doubled. Can you check?', 'The SSO redirect loops back to the login page on Safari.', 'Is there a way to export the pipeline to CSV?', 'We need the refund for order #4821 processed today.', 'Getting 429s from the API since this morning.'];
const MESSAGES_OUT = ['Thanks for flagging. I can see two charges on the 3rd; refunding the duplicate now.', 'Reproduced on Safari 17. A fix ships in tonight\'s release; I\'ll follow up here.', 'Yes: Pipeline → Export → CSV. I can also schedule a weekly export for you.', 'Refund issued. It will show within 5 business days depending on the bank.', 'You hit the 600 req/min limit. I\'ve raised it to 1200 for your workspace.'];

export const hashSeed = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const rng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;

export const personName = (r: () => number): string => `${pick(r, FIRST)} ${pick(r, LAST)}`;
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');

/** `statuses` lets a table declare its own vocabulary, so a posts table reads Draft/Published rather than Trial/Churn risk. */
export const cellFor = (column: string, r: () => number, rowIndex: number, statuses: readonly string[] = STATUSES): string => {
  const c = column.toLowerCase();
  if (/name|member|customer|contact|owner|assignee|author|guest/.test(c)) return personName(r);
  if (/company|account|supplier|client/.test(c)) return pick(r, COMPANIES);
  if (/email/.test(c)) return `${pick(r, FIRST).toLowerCase()}@${pick(r, COMPANIES).toLowerCase().replace(/\s+/g, '')}.com`;
  if (/status|state|fulfil|payment/.test(c)) return pick(r, statuses.length ? statuses : STATUSES);
  if (/plan|tier/.test(c)) return pick(r, PLANS);
  if (/stage/.test(c)) return pick(r, STAGES);
  if (/priority/.test(c)) return pick(r, PRIORITIES);
  if (/role/.test(c)) return pick(r, ['Owner', 'Admin', 'Editor', 'Viewer', 'Billing']);
  if (/mrr|arr|amount|total|value|revenue|price|cost|subtotal/.test(c)) return `$${(120 + r() * 9800).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  if (/order|invoice|id|#|sku|key|prefix/.test(c)) return `#${(1000 + rowIndex * 7 + Math.floor(r() * 5)).toString().padStart(4, '0')}`;
  if (/date|issued|due|renews|placed|updated|created|last|activity|active|seen|expected/.test(c)) {
    const d = Math.floor(r() * 28) + 1;
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][Math.floor(r() * 9)]} ${d}`;
  }
  if (/items|qty|quantity|rows|contacts|deals|members|teams|views|on hand|reserved|reorder/.test(c)) return String(Math.floor(r() * 240));
  if (/permission/.test(c)) return pick(r, ['read', 'read, write', 'admin', 'billing']);
  if (/title|task|item/.test(c)) return pick(r, TASKS);
  if (/category|industry|topic/.test(c)) return pick(r, ['SaaS', 'Retail', 'Healthcare', 'Fintech', 'Logistics', 'Media']);
  if (/domain/.test(c)) return `${pick(r, COMPANIES).toLowerCase().replace(/\s+/g, '')}.com`;
  if (/location|warehouse/.test(c)) return pick(r, ['CPT-1', 'JNB-2', 'LHR-1', 'AMS-3']);
  return pick(r, ['—', 'Yes', 'No', 'Pending', 'Synced']);
};

export const taskCard = (r: () => number): { title: string; assignee: string; priority: string; tag: string } => ({
  title: pick(r, TASKS),
  assignee: personName(r),
  priority: pick(r, PRIORITIES),
  tag: pick(r, ['Design', 'Backend', 'Growth', 'Infra', 'Docs']),
});

export const chatThread = (r: () => number, agent: string): Array<{ from: 'customer' | 'agent'; name: string; text: string; time: string }> => {
  const customer = personName(r);
  const idx = Math.floor(r() * MESSAGES_IN.length);
  const h = 9 + Math.floor(r() * 8);
  const m = Math.floor(r() * 60);
  const t = (offset: number) => `${String(h).padStart(2, '0')}:${String((m + offset) % 60).padStart(2, '0')}`;
  return [
    { from: 'customer', name: customer, text: MESSAGES_IN[idx] ?? MESSAGES_IN[0]!, time: t(0) },
    { from: 'agent', name: agent, text: MESSAGES_OUT[idx] ?? MESSAGES_OUT[0]!, time: t(2) },
    { from: 'customer', name: customer, text: 'Perfect, thank you. That solves it.', time: t(4) },
  ];
};

/** Smooth-ish series in [0.15, 1] with `points` values; `bias` tilts the trend. */
export const series = (r: () => number, points: number, bias: number): number[] => {
  const out: number[] = [];
  let v = 0.35 + r() * 0.3;
  for (let i = 0; i < points; i += 1) {
    v += (r() - 0.5) * 0.18 + bias / points;
    v = Math.max(0.12, Math.min(1, v));
    out.push(v);
  }
  return out;
};
