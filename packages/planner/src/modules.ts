import type { MadNode } from '@mad/schema';
import type { Intent, IntentAnalysis } from './intents';
import {
  type BuildContext,
  badge,
  button,
  card,
  chart,
  chat,
  divider,
  form,
  grid,
  heading,
  input,
  kanban,
  list,
  money,
  percent,
  pricing,
  row,
  section,
  select,
  stack,
  stat,
  table,
  tabs,
  text,
  timeline,
  toggle,
  image,
  pick,
} from './builders';

/**
 * A feature module is what the planner assembles per detected intent. Each one
 * returns the sections it contributes to the main content area, the sidebar
 * item it owns, and the database tables it needs. Sections are emitted in the
 * order returned, so the most important content comes first.
 */
export interface FeatureModule {
  intent: Intent;
  planLabel: string;
  planDetail: string;
  sidebarItem: string;
  tables: Array<{ table: string; columns: string[] }>;
  build: (ctx: BuildContext, analysis: IntentAnalysis) => MadNode[];
}

const kpiRow = (ctx: BuildContext, analysis: IntentAnalysis): MadNode => {
  const hasBilling = analysis.intents.includes('billing');
  const hasCrm = analysis.intents.includes('crm');
  const hasSupport = analysis.intents.includes('support-chat');
  const hasCommerce = analysis.intents.includes('ecommerce');
  const stats: MadNode[] = [];
  if (hasBilling) stats.push(stat(ctx, 'Monthly recurring revenue', money(ctx, 48000, 240000), percent(ctx, 3, 14), 'up'));
  if (hasCrm) stats.push(stat(ctx, 'Open pipeline', money(ctx, 120000, 900000), percent(ctx, 1, 9), 'up'));
  if (hasCommerce) stats.push(stat(ctx, 'Orders today', String(Math.round(80 + ctx.random() * 400)), percent(ctx, 2, 12), 'up'));
  if (hasSupport) stats.push(stat(ctx, 'Median first response', `${Math.round(2 + ctx.random() * 9)}m ${Math.round(ctx.random() * 59)}s`, percent(ctx, -18, -4, true), 'down'));
  if (stats.length < 4) stats.push(stat(ctx, 'Active users (7d)', String(Math.round(1200 + ctx.random() * 9000)), percent(ctx, 2, 11), 'up'));
  if (stats.length < 4) stats.push(stat(ctx, 'Churn (30d)', percent(ctx, 0.6, 2.4, false), percent(ctx, -0.9, -0.1, true), 'down'));
  if (stats.length < 4) stats.push(stat(ctx, 'Conversion', percent(ctx, 2, 7, false), percent(ctx, 0.2, 1.4), 'up'));
  return grid(ctx, 'KPI row', 4, stats.slice(0, 4));
};

export const dashboardModule: FeatureModule = {
  intent: 'dashboard',
  planLabel: 'Compose overview dashboard',
  planDetail: 'KPI row, revenue trend, activity feed',
  sidebarItem: 'Overview',
  tables: [{ table: 'metrics_daily', columns: ['id', 'day', 'metric', 'value', 'workspace_id'] }],
  build: (ctx, analysis) => {
    const primarySeries = analysis.intents.includes('billing') ? ['MRR', 'New', 'Churned'] : analysis.intents.includes('ecommerce') ? ['Orders', 'Revenue'] : ['Active', 'New'];
    return [
      section(
        ctx,
        'Overview',
        [
          kpiRow(ctx, analysis),
          grid(ctx, 'Overview charts', 3, [
            chart(ctx, analysis.intents.includes('billing') ? 'Revenue, trailing 12 months' : 'Activity, trailing 12 weeks', 'area', primarySeries, 12),
            card(ctx, 'Recent activity', [
              timeline(ctx, 'Activity feed', [
                'Sasha closed Acme Corp for $48,000',
                'Invoice #1042 paid via Stripe',
                'New ticket: "SSO redirect loop" (P2)',
                'Deploy v2.14.0 promoted to production',
                'Jordan invited 3 teammates',
              ]),
            ]),
          ]),
        ],
        `Good morning. Here is what changed in ${analysis.appName}.`,
        'OVERVIEW',
      ),
    ];
  },
};

export const crmModule: FeatureModule = {
  intent: 'crm',
  planLabel: 'Build CRM pipeline and contacts',
  planDetail: 'Kanban pipeline, contacts table, deal detail',
  sidebarItem: 'Customers',
  tables: [
    { table: 'contacts', columns: ['id', 'first_name', 'last_name', 'email', 'company_id', 'owner_id', 'lifecycle_stage', 'created_at'] },
    { table: 'companies', columns: ['id', 'name', 'domain', 'industry', 'annual_revenue', 'created_at'] },
    { table: 'deals', columns: ['id', 'name', 'company_id', 'owner_id', 'stage', 'amount_cents', 'currency', 'close_date', 'probability'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Customers',
      [
        row(ctx, 'Customers toolbar', [
          input(ctx, '', 'Search contacts, companies, deals…', 'search'),
          row(ctx, 'Actions', [button(ctx, 'Import CSV', 'secondary', 'upload'), button(ctx, 'New contact', 'primary', 'plus')], { justify: 'end' }),
        ]),
        tabs(ctx, 'Customer views', ['Pipeline', 'Contacts', 'Companies'], [
          kanban(ctx, 'Deal pipeline', ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won'], 3),
          table(ctx, 'Contacts', ['Name', 'Company', 'Stage', 'Owner', 'Last activity', 'Value'], 8),
          table(ctx, 'Companies', ['Company', 'Domain', 'Industry', 'Contacts', 'Open deals', 'ARR'], 6),
        ]),
      ],
      'Every relationship, one pipeline.',
      'CRM',
    ),
  ],
};

export const billingModule: FeatureModule = {
  intent: 'billing',
  planLabel: 'Wire Stripe billing',
  planDetail: 'Subscriptions table, revenue chart, plan management',
  sidebarItem: 'Billing',
  tables: [
    { table: 'customers_billing', columns: ['id', 'contact_id', 'stripe_customer_id', 'default_payment_method', 'created_at'] },
    { table: 'subscriptions', columns: ['id', 'customer_id', 'stripe_subscription_id', 'plan', 'status', 'current_period_end', 'mrr_cents'] },
    { table: 'invoices', columns: ['id', 'subscription_id', 'stripe_invoice_id', 'amount_due_cents', 'status', 'due_at', 'paid_at'] },
    { table: 'stripe_events', columns: ['id', 'stripe_event_id', 'type', 'payload', 'processed_at'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Billing',
      [
        grid(ctx, 'Billing summary', 3, [
          stat(ctx, 'MRR', money(ctx, 52000, 180000), percent(ctx, 2, 9), 'up'),
          stat(ctx, 'Past due', money(ctx, 800, 9000), percent(ctx, -30, -5, true), 'down'),
          stat(ctx, 'Trials converting', percent(ctx, 18, 42, false), percent(ctx, 0.5, 4), 'up'),
        ]),
        grid(ctx, 'Billing detail', 3, [
          chart(ctx, 'Subscriptions by plan', 'donut', ['Starter', 'Growth', 'Scale'], 3),
          card(
            ctx,
            'Subscriptions',
            [table(ctx, 'Active subscriptions', ['Customer', 'Plan', 'Status', 'Renews', 'MRR'], 6, false)],
            'Synced from Stripe every 60s',
            { padding: { top: 20, right: 0, bottom: 0, left: 0 } },
          ),
        ]),
        row(ctx, 'Billing actions', [
          badge(ctx, 'Stripe webhooks: healthy', 'success'),
          row(ctx, 'Actions', [button(ctx, 'Open Stripe dashboard', 'ghost', 'external'), button(ctx, 'Create invoice', 'primary', 'plus')], { justify: 'end' }),
        ]),
      ],
      'Revenue, invoices and dunning in one view.',
      'BILLING',
    ),
  ],
};

export const supportChatModule: FeatureModule = {
  intent: 'support-chat',
  planLabel: 'Add customer support chat',
  planDetail: 'Realtime inbox with agent assist',
  sidebarItem: 'Inbox',
  tables: [
    { table: 'conversations', columns: ['id', 'contact_id', 'assignee_id', 'status', 'priority', 'channel', 'opened_at', 'closed_at'] },
    { table: 'messages', columns: ['id', 'conversation_id', 'author_type', 'author_id', 'body', 'attachments', 'sent_at'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Support inbox',
      [
        grid(ctx, 'Inbox layout', 3, [
          card(ctx, 'Open conversations', [list(ctx, 'Conversations', ['Priya N. · Billing question', 'Marcus T. · SSO redirect loop', 'Elena R. · Feature request: exports', 'Devon K. · Refund status', 'Aiko S. · API rate limits'])], `${Math.round(8 + ctx.random() * 30)} open · ${Math.round(1 + ctx.random() * 6)} unassigned`),
          node2Col(ctx, chat(ctx, 'Conversation', 'Ari (support)')),
        ]),
      ],
      'Median first response under three minutes.',
      'SUPPORT',
    ),
  ],
};

/** A section that names its layer but renders no heading (marketing hero, CTA bands). */
const quietSection = (ctx: BuildContext, name: string, children: MadNode[]): MadNode => {
  const sec = section(ctx, name, children);
  return { ...sec, props: { ...sec.props, title: '' } };
};

const node2Col = (ctx: BuildContext, child: MadNode): MadNode =>
  stack(ctx, 'Conversation pane', [child], { width: 'full', gap: 0 });

export const authModule: FeatureModule = {
  intent: 'auth',
  planLabel: 'Configure authentication',
  planDetail: 'Sign-in, roles and session policy',
  sidebarItem: 'Access',
  tables: [
    { table: 'users', columns: ['id', 'email', 'display_name', 'avatar_url', 'created_at', 'last_seen_at'] },
    { table: 'roles', columns: ['id', 'name', 'permissions'] },
    { table: 'user_roles', columns: ['user_id', 'role_id', 'granted_at'] },
    { table: 'sessions', columns: ['id', 'user_id', 'ip', 'user_agent', 'expires_at'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Access control',
      [
        grid(ctx, 'Access grid', 2, [
          card(ctx, 'Sign-in methods', [
            toggle(ctx, 'Email + password', true),
            toggle(ctx, 'Magic link', true),
            toggle(ctx, 'Google Workspace SSO', true),
            toggle(ctx, 'GitHub', false),
            toggle(ctx, 'Require MFA for admins', true),
          ]),
          card(ctx, 'Roles', [table(ctx, 'Roles', ['Role', 'Members', 'Permissions', 'Updated'], 4, false)], 'Role-based access'),
        ]),
      ],
      'Who can see what, enforced at the API boundary.',
      'AUTH',
    ),
  ],
};

export const analyticsModule: FeatureModule = {
  intent: 'analytics',
  planLabel: 'Generate analytics reports',
  planDetail: 'Funnel, retention cohorts, breakdowns',
  sidebarItem: 'Reports',
  tables: [
    { table: 'events', columns: ['id', 'user_id', 'name', 'properties', 'occurred_at'] },
    { table: 'cohorts', columns: ['id', 'name', 'definition', 'created_at'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Reports',
      [
        row(ctx, 'Report filters', [
          select(ctx, 'Date range', ['Last 7 days', 'Last 30 days', 'Quarter to date', 'Custom']),
          select(ctx, 'Segment', ['All users', 'Paying', 'Trial', 'Churn risk']),
          row(ctx, 'Export', [button(ctx, 'Export CSV', 'secondary', 'download')], { justify: 'end' }),
        ]),
        grid(ctx, 'Report charts', 2, [
          chart(ctx, 'Acquisition funnel', 'bar', ['Visited', 'Signed up', 'Activated', 'Paid'], 4),
          chart(ctx, 'Weekly retention', 'line', ['Week 1', 'Week 4', 'Week 8'], 10),
        ]),
      ],
      'Ask a question, get a chart.',
      'ANALYTICS',
    ),
  ],
};

export const ecommerceModule: FeatureModule = {
  intent: 'ecommerce',
  planLabel: 'Assemble product catalog and orders',
  planDetail: 'Products grid, order management, fulfilment',
  sidebarItem: 'Orders',
  tables: [
    { table: 'products', columns: ['id', 'sku', 'name', 'description', 'price_cents', 'currency', 'inventory_qty', 'status'] },
    { table: 'orders', columns: ['id', 'customer_id', 'status', 'subtotal_cents', 'shipping_cents', 'total_cents', 'placed_at'] },
    { table: 'order_items', columns: ['id', 'order_id', 'product_id', 'quantity', 'unit_price_cents'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Orders',
      [
        row(ctx, 'Orders toolbar', [
          input(ctx, '', 'Search orders, SKUs, customers…', 'search'),
          row(ctx, 'Actions', [badge(ctx, `${Math.round(3 + ctx.random() * 20)} awaiting fulfilment`, 'warning'), button(ctx, 'New order', 'primary', 'plus')], { justify: 'end' }),
        ]),
        table(ctx, 'Orders', ['Order', 'Customer', 'Items', 'Total', 'Payment', 'Fulfilment', 'Placed'], 8),
        grid(ctx, 'Catalog grid', 4, [
          card(ctx, pick(ctx, ['Studio Desk Lamp', 'Field Notebook', 'Wool Throw']), [image(ctx, 'Product photo', '4/3'), text(ctx, money(ctx, 24, 240), 'default', 'md')]),
          card(ctx, pick(ctx, ['Ceramic Mug Set', 'Linen Apron', 'Brass Bottle Opener']), [image(ctx, 'Product photo', '4/3'), text(ctx, money(ctx, 24, 240), 'default', 'md')]),
          card(ctx, pick(ctx, ['Walnut Tray', 'Canvas Tote', 'Desk Mat']), [image(ctx, 'Product photo', '4/3'), text(ctx, money(ctx, 24, 240), 'default', 'md')]),
          card(ctx, pick(ctx, ['Travel Kit', 'Weekender Bag', 'Card Wallet']), [image(ctx, 'Product photo', '4/3'), text(ctx, money(ctx, 24, 240), 'default', 'md')]),
        ]),
      ],
      'Catalog, checkout and fulfilment.',
      'COMMERCE',
    ),
  ],
};

export const tasksModule: FeatureModule = {
  intent: 'tasks',
  planLabel: 'Create task board',
  planDetail: 'Kanban with sprints and assignees',
  sidebarItem: 'Board',
  tables: [
    { table: 'projects', columns: ['id', 'name', 'key', 'lead_id', 'created_at'] },
    { table: 'tasks', columns: ['id', 'project_id', 'title', 'description', 'status', 'priority', 'assignee_id', 'due_at', 'position'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Board',
      [
        row(ctx, 'Board toolbar', [row(ctx, 'Actions', [select(ctx, 'Sprint', ['Sprint 14', 'Sprint 15', 'Backlog']), button(ctx, 'New task', 'primary', 'plus')], { justify: 'end' })]),
        // Three real views of the same work, so every tab lands somewhere.
        tabs(ctx, 'Board views', ['Board', 'List', 'Timeline'], [
          kanban(ctx, 'Task board', ['Backlog', 'In progress', 'In review', 'Done'], 4),
          table(ctx, 'All tasks', ['Title', 'Status', 'Priority', 'Assignee', 'Due date'], 8, true, ['Backlog', 'In progress', 'In review', 'Done', 'Blocked']),
          timeline(ctx, 'Task activity', ['Ship billing webhook moved to In review', 'Retry logic merged', 'Sprint 14 planning closed', 'Two tasks reassigned to Devon']),
        ]),
      ],
      'Work, in flight.',
      'TASKS',
    ),
  ],
};

export const calendarModule: FeatureModule = {
  intent: 'calendar',
  planLabel: 'Add scheduling and bookings',
  planDetail: 'Availability, booking form, upcoming events',
  sidebarItem: 'Schedule',
  tables: [
    { table: 'availability_rules', columns: ['id', 'user_id', 'weekday', 'start_time', 'end_time', 'timezone'] },
    { table: 'bookings', columns: ['id', 'host_id', 'guest_email', 'guest_name', 'starts_at', 'ends_at', 'status', 'notes'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Schedule',
      [
        grid(ctx, 'Schedule grid', 3, [
          card(ctx, 'Upcoming', [timeline(ctx, 'Upcoming bookings', ['09:30 · Onboarding call with Priya N.', '11:00 · Design review', '13:30 · Quarterly planning', '15:00 · Demo for Acme Corp', '16:30 · 1:1 with Jordan'])], 'Today'),
          form(ctx, 'New booking', [input(ctx, 'Guest name', 'Full name', 'text', true), input(ctx, 'Guest email', 'name@company.com', 'email', true), select(ctx, 'Duration', ['15 min', '30 min', '45 min', '60 min']), select(ctx, 'Type', ['Discovery call', 'Demo', 'Support', 'Other'])], 'Book time', 'two-column'),
        ]),
      ],
      'Availability, bookings and reminders.',
      'SCHEDULE',
    ),
  ],
};

export const cmsModule: FeatureModule = {
  intent: 'cms',
  planLabel: 'Set up content management',
  planDetail: 'Posts table, editor, publishing states',
  sidebarItem: 'Content',
  tables: [
    { table: 'posts', columns: ['id', 'title', 'slug', 'body', 'status', 'author_id', 'published_at', 'updated_at'] },
    { table: 'categories', columns: ['id', 'name', 'slug'] },
    { table: 'post_categories', columns: ['post_id', 'category_id'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Content',
      [
        row(ctx, 'Content toolbar', [
          // The labels are the values in the Status column, so the filter has something to match.
          tabs(ctx, 'Content states', ['All', 'Draft', 'Scheduled', 'Published'], []),
          row(ctx, 'Actions', [button(ctx, 'New post', 'primary', 'plus')], { justify: 'end' }),
        ]),
        table(ctx, 'Posts', ['Title', 'Author', 'Category', 'Status', 'Updated', 'Views'], 8, true, ['Draft', 'Scheduled', 'Published', 'Review']),
      ],
      'Draft, review, publish.',
      'CONTENT',
    ),
  ],
};

export const inventoryModule: FeatureModule = {
  intent: 'inventory',
  planLabel: 'Model inventory and suppliers',
  planDetail: 'Stock levels, reorder points, suppliers',
  sidebarItem: 'Inventory',
  tables: [
    { table: 'items', columns: ['id', 'sku', 'name', 'quantity_on_hand', 'reorder_point', 'unit_cost_cents', 'location_id'] },
    { table: 'suppliers', columns: ['id', 'name', 'contact_email', 'lead_time_days'] },
    { table: 'purchase_orders', columns: ['id', 'supplier_id', 'status', 'expected_at', 'total_cents'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Inventory',
      [
        grid(ctx, 'Inventory summary', 3, [
          stat(ctx, 'SKUs tracked', String(Math.round(400 + ctx.random() * 3000)), percent(ctx, 0.5, 3), 'up'),
          stat(ctx, 'Below reorder point', String(Math.round(2 + ctx.random() * 40)), percent(ctx, -20, 10), 'flat'),
          stat(ctx, 'Inventory value', money(ctx, 120000, 1400000), percent(ctx, 1, 6), 'up'),
        ]),
        table(ctx, 'Stock levels', ['SKU', 'Item', 'On hand', 'Reserved', 'Reorder at', 'Supplier', 'Status'], 8),
      ],
      'Know what you have before you need it.',
      'INVENTORY',
    ),
  ],
};

export const invoicesModule: FeatureModule = {
  intent: 'invoices',
  planLabel: 'Add invoicing and quotes',
  planDetail: 'Invoice list, aging, quote builder',
  sidebarItem: 'Invoices',
  tables: [
    { table: 'quotes', columns: ['id', 'customer_id', 'status', 'total_cents', 'valid_until', 'created_at'] },
    { table: 'invoice_lines', columns: ['id', 'invoice_id', 'description', 'quantity', 'unit_price_cents', 'tax_rate'] },
  ],
  build: (ctx) => [
    section(
      ctx,
      'Invoices',
      [
        grid(ctx, 'Aging', 4, [
          stat(ctx, 'Outstanding', money(ctx, 20000, 200000), percent(ctx, -8, 4), 'flat'),
          stat(ctx, 'Overdue 30+', money(ctx, 1000, 30000), percent(ctx, -20, -2, true), 'down'),
          stat(ctx, 'Paid this month', money(ctx, 30000, 300000), percent(ctx, 2, 12), 'up'),
          stat(ctx, 'Avg. days to pay', String(Math.round(12 + ctx.random() * 30)), percent(ctx, -6, -1, true), 'down'),
        ]),
        table(ctx, 'Invoices', ['Invoice', 'Customer', 'Issued', 'Due', 'Amount', 'Status'], 8),
      ],
      'Get paid faster.',
      'INVOICING',
    ),
  ],
};

export const teamModule: FeatureModule = {
  intent: 'team',
  planLabel: 'Add team directory',
  planDetail: 'Members, roles, invitations',
  sidebarItem: 'Team',
  tables: [{ table: 'invitations', columns: ['id', 'email', 'role_id', 'invited_by', 'expires_at', 'accepted_at'] }],
  build: (ctx) => [
    section(
      ctx,
      'Team',
      [
        row(ctx, 'Team toolbar', [input(ctx, '', 'Search people…', 'search'), row(ctx, 'Actions', [button(ctx, 'Invite teammate', 'primary', 'plus')], { justify: 'end' })]),
        table(ctx, 'Members', ['Member', 'Role', 'Teams', 'Last active', 'Status'], 8, false),
      ],
      'Everyone who ships with you.',
      'TEAM',
    ),
  ],
};

export const settingsModule: FeatureModule = {
  intent: 'settings',
  planLabel: 'Add workspace settings',
  planDetail: 'Profile, API keys, danger zone',
  sidebarItem: 'Settings',
  tables: [{ table: 'api_keys', columns: ['id', 'workspace_id', 'name', 'hashed_key', 'last_used_at', 'created_at', 'revoked_at'] }],
  build: (ctx) => [
    section(
      ctx,
      'Settings',
      [
        grid(ctx, 'Settings grid', 2, [
          form(ctx, 'Workspace', [input(ctx, 'Workspace name', 'Acme Inc.'), input(ctx, 'Support email', 'support@acme.com', 'email'), select(ctx, 'Timezone', ['UTC', 'Africa/Johannesburg', 'Europe/London', 'America/New_York'])], 'Save changes', 'single'),
          card(ctx, 'API keys', [table(ctx, 'API keys', ['Name', 'Prefix', 'Last used', 'Created'], 3, false), button(ctx, 'Generate key', 'secondary', 'key')]),
        ]),
        card(ctx, 'Danger zone', [row(ctx, 'Delete workspace', [text(ctx, 'Permanently delete this workspace and all of its data.', 'muted', 'sm'), button(ctx, 'Delete workspace', 'danger', 'trash')])], '', { border: true }),
      ],
      '',
      'SETTINGS',
    ),
  ],
};

export const notificationsModule: FeatureModule = {
  intent: 'notifications',
  planLabel: 'Configure notifications',
  planDetail: 'Email, SMS and in-app channels',
  sidebarItem: 'Notifications',
  tables: [{ table: 'notification_preferences', columns: ['user_id', 'channel', 'event', 'enabled'] }, { table: 'notifications', columns: ['id', 'user_id', 'kind', 'payload', 'read_at', 'created_at'] }],
  build: (ctx) => [
    section(
      ctx,
      'Notifications',
      [
        card(ctx, 'Channels', [toggle(ctx, 'Email digests', true), toggle(ctx, 'SMS for critical alerts', false), toggle(ctx, 'In-app notifications', true), toggle(ctx, 'Slack channel updates', true)]),
      ],
      '',
      'NOTIFICATIONS',
    ),
  ],
};

export const landingModule: FeatureModule = {
  intent: 'landing',
  planLabel: 'Design marketing landing page',
  planDetail: 'Hero, feature grid, pricing, CTA',
  sidebarItem: 'Home',
  tables: [{ table: 'waitlist', columns: ['id', 'email', 'source', 'created_at'] }],
  build: (ctx, analysis) => [
    quietSection(
      ctx,
      'Hero',
      [
        stack(ctx, 'Hero copy', [
          badge(ctx, 'Now in public beta', 'info'),
          heading(ctx, `${analysis.appName}: the fastest way to ship.`, 1, 'bold'),
          text(ctx, 'Replace six tools with one workspace. Built for teams who would rather ship than configure.', 'muted', 'lg'),
          row(ctx, 'Hero actions', [button(ctx, 'Start free', 'primary', 'arrow', 'lg'), button(ctx, 'Book a demo', 'ghost', '', 'lg')], { justify: 'start' }),
        ], { align: 'start', gap: 20 }),
        image(ctx, 'Product screenshot', '16/9'),
      ],
    ),
    section(
      ctx,
      'Features',
      [
        grid(ctx, 'Feature grid', 3, [
          card(ctx, 'Realtime by default', [text(ctx, 'Every change syncs to every collaborator in under 50ms.')]),
          card(ctx, 'Your data, your schema', [text(ctx, 'Postgres underneath. Export any time, no lock-in.')]),
          card(ctx, 'Enterprise ready', [text(ctx, 'SSO, audit logs, and regional hosting on every plan.')]),
        ]),
      ],
      'Everything you need, nothing you have to babysit.',
      'WHY',
    ),
    section(ctx, 'Pricing', [pricing(ctx, ['Starter', 'Growth', 'Scale'], 1)], 'Simple pricing that scales with you.', 'PRICING'),
    quietSection(ctx, 'Call to action', [card(ctx, 'Ready to start?', [row(ctx, 'CTA row', [input(ctx, '', 'you@company.com', 'email'), button(ctx, 'Join the waitlist', 'primary', 'arrow')])], 'Join 4,200 teams already building.')]),
  ],
};

export const mobileModule: FeatureModule = {
  intent: 'mobile',
  planLabel: 'Optimise for mobile shell',
  planDetail: 'Tab bar, thumb-reach actions',
  sidebarItem: 'Home',
  tables: [{ table: 'devices', columns: ['id', 'user_id', 'platform', 'push_token', 'last_seen_at'] }],
  build: (ctx) => [
    section(ctx, 'Home', [grid(ctx, 'Mobile stats', 2, [stat(ctx, 'Today', money(ctx, 200, 4000), percent(ctx, 1, 8), 'up'), stat(ctx, 'Pending', String(Math.round(1 + ctx.random() * 12)), percent(ctx, -10, 10), 'flat')]), divider(ctx), list(ctx, 'Quick actions', ['Scan receipt', 'New entry', 'Share report'])], '', 'MOBILE'),
  ],
};

export const MODULES: Record<Intent, FeatureModule> = {
  dashboard: dashboardModule,
  crm: crmModule,
  billing: billingModule,
  'support-chat': supportChatModule,
  auth: authModule,
  analytics: analyticsModule,
  ecommerce: ecommerceModule,
  landing: landingModule,
  tasks: tasksModule,
  calendar: calendarModule,
  cms: cmsModule,
  inventory: inventoryModule,
  invoices: invoicesModule,
  team: teamModule,
  settings: settingsModule,
  notifications: notificationsModule,
  mobile: mobileModule,
};
