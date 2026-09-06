/**
 * Intent detection. The planner does not call a model; it reads the prompt
 * against a curated vocabulary and produces a ranked set of feature intents,
 * a product archetype, and the integrations the prompt implies. This keeps
 * generation deterministic (same prompt + seed = same document), instant, and
 * testable, while the event stream shape is identical to what a model-backed
 * planner emits.
 */

export const INTENTS = [
  'dashboard',
  'crm',
  'billing',
  'support-chat',
  'auth',
  'analytics',
  'ecommerce',
  'landing',
  'tasks',
  'calendar',
  'cms',
  'inventory',
  'invoices',
  'team',
  'settings',
  'notifications',
  'mobile',
] as const;
export type Intent = (typeof INTENTS)[number];

export const ARCHETYPES = ['internal-tool', 'saas', 'marketplace', 'marketing-site', 'mobile-app'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

interface Rule {
  intent: Intent;
  terms: readonly string[];
  weight: number;
}

const RULES: readonly Rule[] = [
  { intent: 'dashboard', terms: ['dashboard', 'admin', 'overview', 'kpi', 'metrics', 'internal tool', 'back office', 'backoffice', 'panel'], weight: 1 },
  { intent: 'crm', terms: ['crm', 'customer', 'customers', 'contact', 'contacts', 'lead', 'leads', 'pipeline', 'deal', 'deals', 'sales', 'account manager'], weight: 1.2 },
  { intent: 'billing', terms: ['billing', 'stripe', 'payment', 'payments', 'subscription', 'subscriptions', 'invoice', 'checkout', 'pricing', 'plan', 'paywall', 'revenue'], weight: 1.2 },
  { intent: 'support-chat', terms: ['chat', 'support', 'helpdesk', 'help desk', 'ticket', 'tickets', 'live chat', 'messaging', 'inbox', 'conversation', 'intercom', 'assistant'], weight: 1.1 },
  { intent: 'auth', terms: ['login', 'log in', 'sign in', 'signin', 'sign up', 'signup', 'auth', 'authentication', 'sso', 'oauth', 'magic link', 'password', 'roles', 'permissions', 'rbac'], weight: 0.9 },
  { intent: 'analytics', terms: ['analytics', 'report', 'reports', 'chart', 'charts', 'graph', 'insights', 'funnel', 'retention', 'cohort', 'trend'], weight: 1 },
  { intent: 'ecommerce', terms: ['shop', 'store', 'storefront', 'ecommerce', 'e-commerce', 'product catalog', 'catalog', 'cart', 'marketplace', 'orders', 'order management'], weight: 1.2 },
  { intent: 'landing', terms: ['landing', 'landing page', 'marketing', 'website', 'homepage', 'hero', 'waitlist', 'launch', 'portfolio', 'brochure'], weight: 1.1 },
  { intent: 'tasks', terms: ['task', 'tasks', 'todo', 'to-do', 'kanban', 'board', 'project management', 'sprint', 'backlog', 'issue', 'issues', 'workflow'], weight: 1 },
  { intent: 'calendar', terms: ['calendar', 'schedule', 'scheduling', 'booking', 'bookings', 'appointment', 'appointments', 'availability', 'events'], weight: 1 },
  { intent: 'cms', terms: ['cms', 'blog', 'content', 'articles', 'posts', 'wordpress', 'editor', 'publishing', 'docs', 'documentation', 'knowledge base'], weight: 1 },
  { intent: 'inventory', terms: ['inventory', 'stock', 'warehouse', 'sku', 'skus', 'supplier', 'suppliers', 'procurement', 'assets'], weight: 1 },
  { intent: 'invoices', terms: ['invoice', 'invoices', 'quote', 'quotes', 'estimate', 'accounting', 'ledger', 'expenses', 'bookkeeping'], weight: 1 },
  { intent: 'team', terms: ['team', 'members', 'employees', 'staff', 'hr', 'onboarding', 'directory', 'org chart', 'people'], weight: 0.8 },
  { intent: 'settings', terms: ['settings', 'preferences', 'configuration', 'profile', 'workspace settings', 'api keys'], weight: 0.7 },
  { intent: 'notifications', terms: ['notification', 'notifications', 'alerts', 'email', 'emails', 'sms', 'push', 'digest', 'reminders'], weight: 0.8 },
  { intent: 'mobile', terms: ['mobile', 'ios', 'android', 'iphone', 'app store', 'native', 'react native', 'flutter', 'phone'], weight: 0.9 },
];

export interface IntegrationMatch {
  slug: string;
  label: string;
  scopes: readonly string[];
  terms: readonly string[];
  impliedBy?: readonly Intent[];
}

export const INTEGRATION_RULES: readonly IntegrationMatch[] = [
  { slug: 'stripe', label: 'Stripe', scopes: ['customers:read', 'subscriptions:write', 'invoices:read', 'webhooks'], terms: ['stripe', 'billing', 'subscription', 'payment', 'checkout'], impliedBy: ['billing'] },
  { slug: 'paddle', label: 'Paddle', scopes: ['transactions:read', 'subscriptions:write'], terms: ['paddle'] },
  { slug: 'hubspot', label: 'HubSpot', scopes: ['crm.objects.contacts.read', 'crm.objects.deals.write'], terms: ['hubspot'] },
  { slug: 'salesforce', label: 'Salesforce', scopes: ['api', 'refresh_token'], terms: ['salesforce'] },
  { slug: 'pipedrive', label: 'Pipedrive', scopes: ['deals:full', 'contacts:full'], terms: ['pipedrive'] },
  { slug: 'intercom', label: 'Intercom', scopes: ['conversations:read', 'conversations:write', 'contacts:read'], terms: ['intercom'] },
  { slug: 'mad-chat', label: 'MAD Realtime Chat', scopes: ['channels:write', 'presence'], terms: ['support chat', 'live chat', 'chat'], impliedBy: ['support-chat'] },
  { slug: 'supabase-auth', label: 'Supabase Auth', scopes: ['email', 'oauth:google', 'oauth:github', 'mfa'], terms: ['supabase', 'login', 'sign in', 'auth'], impliedBy: ['auth'] },
  { slug: 'clerk', label: 'Clerk', scopes: ['users:read', 'sessions:read'], terms: ['clerk'] },
  { slug: 'auth0', label: 'Auth0', scopes: ['openid', 'profile', 'email'], terms: ['auth0', 'okta'] },
  { slug: 'postgres', label: 'PostgreSQL', scopes: ['schema:write', 'rows:read', 'rows:write'], terms: ['postgres', 'postgresql', 'database', 'db', 'sql'] },
  { slug: 'resend', label: 'Resend', scopes: ['emails:send', 'domains:read'], terms: ['resend', 'email', 'emails', 'transactional email'], impliedBy: ['notifications'] },
  { slug: 'twilio', label: 'Twilio', scopes: ['sms:send', 'verify'], terms: ['twilio', 'sms', 'text message'] },
  { slug: 'segment', label: 'Segment', scopes: ['track', 'identify'], terms: ['segment', 'analytics', 'tracking'], impliedBy: ['analytics'] },
  { slug: 'posthog', label: 'PostHog', scopes: ['events:capture', 'feature-flags:read'], terms: ['posthog', 'feature flag', 'feature flags'] },
  { slug: 's3', label: 'Object Storage (S3)', scopes: ['objects:read', 'objects:write'], terms: ['upload', 'uploads', 'files', 'storage', 's3', 'attachments', 'images'] },
  { slug: 'shopify', label: 'Shopify', scopes: ['read_products', 'read_orders'], terms: ['shopify'] },
  { slug: 'google-calendar', label: 'Google Calendar', scopes: ['calendar.events'], terms: ['google calendar', 'calendar', 'booking', 'appointment'], impliedBy: ['calendar'] },
  { slug: 'slack', label: 'Slack', scopes: ['chat:write', 'channels:read'], terms: ['slack'] },
  { slug: 'openai-compatible', label: 'LLM Gateway', scopes: ['completions', 'embeddings'], terms: ['ai', 'gpt', 'llm', 'assistant', 'copilot', 'summarize', 'summarise'] },
];

export interface IntentAnalysis {
  archetype: Archetype;
  intents: Intent[];
  scores: Record<Intent, number>;
  integrations: IntegrationMatch[];
  entities: string[];
  appName: string;
  normalized: string;
}

const STOP = new Set(['a', 'an', 'the', 'with', 'and', 'for', 'to', 'of', 'in', 'on', 'that', 'my', 'our', 'me', 'build', 'create', 'make', 'generate', 'app', 'application', 'internal', 'simple', 'basic', 'full', 'featuring', 'including', 'has', 'have', 'which', 'where', 'using', 'please', 'want', 'need', 'i']);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsTerm = (haystack: string, term: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, 'i').test(haystack);

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

const INTENT_NOUN: Record<Intent, string> = {
  dashboard: 'Dashboard',
  crm: 'CRM',
  billing: 'Billing',
  'support-chat': 'Support',
  auth: 'Access',
  analytics: 'Analytics',
  ecommerce: 'Commerce',
  landing: 'Launch',
  tasks: 'Tasks',
  calendar: 'Scheduling',
  cms: 'Content',
  inventory: 'Inventory',
  invoices: 'Invoicing',
  team: 'Team',
  settings: 'Workspace',
  notifications: 'Alerts',
  mobile: 'Mobile',
};

const ARCHETYPE_NOUN: Record<Archetype, string> = {
  'internal-tool': 'Console',
  saas: 'Platform',
  marketplace: 'Marketplace',
  'marketing-site': 'Site',
  'mobile-app': 'App',
};

/**
 * Names read like products, not keyword soup: "CRM Dashboard", "Coffee Subscription",
 * "Commerce Marketplace". Marketing sites take their name from the prompt's own nouns.
 */
export const deriveAppName = (archetype: Archetype, intents: Intent[], entities: string[], explicitDashboard: boolean): string => {
  if (archetype === 'marketing-site' || archetype === 'mobile-app') {
    const NAME_STOP = new Set(['landing', 'page', 'mobile', 'waitlist', 'pricing', 'website', 'site', 'homepage']);
    const fromEntities = entities.filter((e) => !INTENTS.includes(e as Intent) && !NAME_STOP.has(e)).slice(0, 2);
    if (fromEntities.length) return titleCase(fromEntities.join(' ').replace(/-/g, ' '));
  }
  const primary = intents.find((x) => x !== 'dashboard' && x !== 'mobile' && x !== 'landing');
  if (explicitDashboard) {
    return primary ? `${INTENT_NOUN[primary]} Dashboard` : 'Operations Dashboard';
  }
  const head = primary ? INTENT_NOUN[primary] : titleCase(entities[0] ?? 'Workspace');
  return `${head} ${ARCHETYPE_NOUN[archetype]}`;
};

export const analyzePrompt = (prompt: string): IntentAnalysis => {
  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const scores = Object.fromEntries(INTENTS.map((i) => [i, 0])) as Record<Intent, number>;

  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (containsTerm(normalized, term)) {
        scores[rule.intent] += rule.weight * (term.includes(' ') ? 1.4 : 1);
      }
    }
  }

  const ranked = INTENTS.filter((i) => scores[i] > 0).sort((a, b) => scores[b] - scores[a]);

  // A prompt with no recognisable product intent still deserves a coherent app.
  const intents: Intent[] = ranked.length ? ranked : ['dashboard', 'analytics'];
  const explicitDashboard = intents.includes('dashboard');
  if (!explicitDashboard && !intents.includes('landing') && !intents.includes('mobile')) {
    intents.push('dashboard');
  }

  const archetype: Archetype = intents.includes('landing') && !intents.includes('dashboard')
    ? 'marketing-site'
    : intents.includes('mobile')
      ? 'mobile-app'
      : intents.includes('ecommerce')
        ? 'marketplace'
        : intents.includes('billing') && intents.includes('auth')
          ? 'saas'
          : 'internal-tool';

  const integrations: IntegrationMatch[] = [];
  for (const rule of INTEGRATION_RULES) {
    const direct = rule.terms.some((t) => containsTerm(normalized, t));
    const implied = rule.impliedBy?.some((i) => intents.includes(i)) ?? false;
    if ((direct || implied) && !integrations.some((x) => x.slug === rule.slug)) {
      integrations.push(rule);
    }
  }
  // Every generated app persists somewhere.
  if (!integrations.some((i) => i.slug === 'postgres')) {
    const pg = INTEGRATION_RULES.find((r) => r.slug === 'postgres');
    if (pg) integrations.push(pg);
  }
  // Mutually exclusive vendor families: keep the one named by vendor (terms[0] is always the vendor name).
  const explicit = (slug: string) => {
    const vendor = INTEGRATION_RULES.find((r) => r.slug === slug)?.terms[0];
    return vendor ? containsTerm(normalized, vendor) : false;
  };
  const dedupeFamily = (family: string[]) => {
    const present = family.filter((slug) => integrations.some((i) => i.slug === slug));
    if (present.length > 1) {
      const keep = present.find(explicit) ?? present[0];
      for (const slug of present) {
        if (slug !== keep) {
          const idx = integrations.findIndex((i) => i.slug === slug);
          if (idx >= 0) integrations.splice(idx, 1);
        }
      }
    }
  };
  dedupeFamily(['supabase-auth', 'clerk', 'auth0']);
  dedupeFamily(['stripe', 'paddle']);
  dedupeFamily(['intercom', 'mad-chat']);

  const entities = Array.from(
    new Set(
      normalized
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w)),
    ),
  ).slice(0, 12);

  const appName = deriveAppName(archetype, intents, entities, explicitDashboard);

  return { archetype, intents, scores, integrations, entities, appName, normalized };
};
