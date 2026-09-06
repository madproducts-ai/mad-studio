import type { Integration, User, Workspace } from '@mad/schema';

/** Fixed ids make the demo account addressable from the web app and tests. */
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';

const now = () => new Date().toISOString();

export const DEMO_USER: User = {
  id: DEMO_USER_ID,
  email: 'demo@madproducts.ai',
  displayName: 'Demo',
  avatarUrl: null,
  plan: 'team',
  createdAt: now(),
  updatedAt: now(),
};

export const DEMO_WORKSPACE: Workspace = {
  id: DEMO_WORKSPACE_ID,
  ownerId: DEMO_USER_ID,
  name: 'MAD Products',
  slug: 'mad-products',
  createdAt: now(),
  updatedAt: now(),
};

export const INTEGRATION_CATALOG: Integration[] = [
  { slug: 'stripe', name: 'Stripe', category: 'payments', description: 'Subscriptions, invoices, checkout and webhooks.', scopes: ['customers:read', 'subscriptions:write', 'invoices:read', 'webhooks'], docsUrl: 'https://docs.stripe.com', status: 'available' },
  { slug: 'paddle', name: 'Paddle', category: 'payments', description: 'Merchant-of-record billing with global tax handled.', scopes: ['transactions:read', 'subscriptions:write'], docsUrl: 'https://developer.paddle.com', status: 'available' },
  { slug: 'hubspot', name: 'HubSpot', category: 'crm', description: 'Two-way sync of contacts, companies and deals.', scopes: ['crm.objects.contacts.read', 'crm.objects.deals.write'], docsUrl: 'https://developers.hubspot.com', status: 'available' },
  { slug: 'salesforce', name: 'Salesforce', category: 'crm', description: 'Connect to Sales Cloud objects and flows.', scopes: ['api', 'refresh_token'], docsUrl: 'https://developer.salesforce.com', status: 'beta' },
  { slug: 'pipedrive', name: 'Pipedrive', category: 'crm', description: 'Pipeline-first CRM sync.', scopes: ['deals:full', 'contacts:full'], docsUrl: 'https://developers.pipedrive.com', status: 'available' },
  { slug: 'intercom', name: 'Intercom', category: 'messaging', description: 'Customer conversations and help center.', scopes: ['conversations:read', 'conversations:write', 'contacts:read'], docsUrl: 'https://developers.intercom.com', status: 'available' },
  { slug: 'mad-chat', name: 'MAD Realtime Chat', category: 'messaging', description: 'Built-in realtime channels with presence and typing indicators.', scopes: ['channels:write', 'presence'], docsUrl: 'https://studio.madproducts.ai/docs/chat', status: 'available' },
  { slug: 'supabase-auth', name: 'Supabase Auth', category: 'auth', description: 'Email, magic links, OAuth and MFA.', scopes: ['email', 'oauth:google', 'oauth:github', 'mfa'], docsUrl: 'https://supabase.com/docs/guides/auth', status: 'available' },
  { slug: 'clerk', name: 'Clerk', category: 'auth', description: 'Drop-in user management with organisations.', scopes: ['users:read', 'sessions:read'], docsUrl: 'https://clerk.com/docs', status: 'available' },
  { slug: 'auth0', name: 'Auth0', category: 'auth', description: 'Enterprise identity with SSO and SAML.', scopes: ['openid', 'profile', 'email'], docsUrl: 'https://auth0.com/docs', status: 'available' },
  { slug: 'postgres', name: 'PostgreSQL', category: 'database', description: 'Managed Postgres with migrations generated from your schema.', scopes: ['schema:write', 'rows:read', 'rows:write'], docsUrl: 'https://www.postgresql.org/docs/', status: 'available' },
  { slug: 'resend', name: 'Resend', category: 'email', description: 'Transactional email with React templates.', scopes: ['emails:send', 'domains:read'], docsUrl: 'https://resend.com/docs', status: 'available' },
  { slug: 'twilio', name: 'Twilio', category: 'messaging', description: 'SMS, voice and verification.', scopes: ['sms:send', 'verify'], docsUrl: 'https://www.twilio.com/docs', status: 'available' },
  { slug: 'segment', name: 'Segment', category: 'analytics', description: 'Customer data platform with 300+ destinations.', scopes: ['track', 'identify'], docsUrl: 'https://segment.com/docs', status: 'available' },
  { slug: 'posthog', name: 'PostHog', category: 'analytics', description: 'Product analytics, replays and feature flags.', scopes: ['events:capture', 'feature-flags:read'], docsUrl: 'https://posthog.com/docs', status: 'available' },
  { slug: 's3', name: 'Object Storage (S3)', category: 'storage', description: 'S3-compatible buckets with signed uploads.', scopes: ['objects:read', 'objects:write'], docsUrl: 'https://docs.aws.amazon.com/s3/', status: 'available' },
  { slug: 'shopify', name: 'Shopify', category: 'crm', description: 'Products, orders and customers from your store.', scopes: ['read_products', 'read_orders'], docsUrl: 'https://shopify.dev/docs', status: 'beta' },
  { slug: 'google-calendar', name: 'Google Calendar', category: 'messaging', description: 'Availability and event sync.', scopes: ['calendar.events'], docsUrl: 'https://developers.google.com/calendar', status: 'available' },
  { slug: 'slack', name: 'Slack', category: 'messaging', description: 'Post to channels and respond to slash commands.', scopes: ['chat:write', 'channels:read'], docsUrl: 'https://api.slack.com', status: 'available' },
  { slug: 'openai-compatible', name: 'LLM Gateway', category: 'analytics', description: 'Route completions and embeddings to any model provider.', scopes: ['completions', 'embeddings'], docsUrl: 'https://studio.madproducts.ai/docs/llm', status: 'beta' },
];
