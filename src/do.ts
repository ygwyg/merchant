import { DurableObject } from 'cloudflare:workers';

export interface MerchantEnv {
  MERCHANT: DurableObjectNamespace<MerchantDO>;
  IMAGES?: R2Bucket;
  IMAGES_URL?: string;
  STORE_NAME?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export type WSEventType =
  | 'cart.updated'
  | 'cart.checked_out'
  | 'order.created'
  | 'order.updated'
  | 'order.shipped'
  | 'order.refunded'
  | 'inventory.updated'
  | 'inventory.low';

export interface WSEvent {
  type: WSEventType;
  data: unknown;
  timestamp: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('public', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  weight_g INTEGER NOT NULL,
  dims_cm TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('restock', 'correction', 'damaged', 'return', 'sale', 'release')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'checked_out', 'expired')),
  customer_email TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_checkout_session_id TEXT,
  discount_code TEXT,
  discount_id TEXT REFERENCES discounts(id),
  discount_amount_cents INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id),
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'refunded', 'canceled')),
  customer_email TEXT NOT NULL,
  shipping_name TEXT,
  shipping_phone TEXT,
  ship_to TEXT,
  subtotal_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  discount_code TEXT,
  discount_id TEXT REFERENCES discounts(id),
  discount_amount_cents INTEGER DEFAULT 0,
  tracking_number TEXT,
  tracking_url TEXT,
  shipped_at TEXT,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  stripe_refund_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed_amount')),
  value INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  min_purchase_cents INTEGER DEFAULT 0,
  max_discount_cents INTEGER,
  starts_at TEXT,
  expires_at TEXT,
  usage_limit INTEGER,
  usage_limit_per_customer INTEGER DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  stripe_coupon_id TEXT,
  stripe_promotion_code_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discount_usage (
  id TEXT PRIMARY KEY,
  discount_id TEXT NOT NULL REFERENCES discounts(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  customer_email TEXT NOT NULL,
  discount_amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  phone TEXT,
  password_hash TEXT,
  email_verified_at TEXT,
  auth_provider TEXT,
  auth_provider_id TEXT,
  accepts_marketing INTEGER DEFAULT 0,
  locale TEXT DEFAULT 'en',
  metadata TEXT,
  order_count INTEGER DEFAULT 0,
  total_spent_cents INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_order_at TEXT
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  is_default INTEGER DEFAULT 0,
  name TEXT,
  company TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  response_code INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_authorizations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  customer_email TEXT,
  magic_token_hash TEXT,
  magic_expires_at TEXT,
  code_hash TEXT,
  code_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'used', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  access_token_hash TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ucp_checkout_sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'incomplete',
  currency TEXT NOT NULL,
  line_items TEXT NOT NULL,
  buyer TEXT,
  totals TEXT NOT NULL,
  messages TEXT,
  payment_instruments TEXT,
  stripe_session_id TEXT,
  order_id TEXT,
  order_number TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON variants(sku);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory(sku);
CREATE INDEX IF NOT EXISTS idx_carts_expires ON carts(expires_at);
CREATE INDEX IF NOT EXISTS idx_carts_status ON carts(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_discounts_code ON discounts(code);
CREATE INDEX IF NOT EXISTS idx_discounts_status ON discounts(status);
CREATE INDEX IF NOT EXISTS idx_discount_usage_order ON discount_usage(order_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_customer ON discount_usage(discount_id, customer_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_usage_order_discount ON discount_usage(order_id, discount_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_status ON webhooks(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_authorizations_client ON oauth_authorizations(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access ON oauth_tokens(access_token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_customer ON oauth_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_email_created ON orders(customer_email, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(number);
CREATE INDEX IF NOT EXISTS idx_variants_status ON variants(status);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_sku_created ON inventory_logs(sku, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_last_order ON customers(last_order_at);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_events_stripe_event_id ON events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_events_type_processed ON events(type, processed_at);
CREATE INDEX IF NOT EXISTS idx_ucp_checkout_sessions_status ON ucp_checkout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_ucp_checkout_sessions_stripe ON ucp_checkout_sessions(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_ucp_checkout_sessions_expires ON ucp_checkout_sessions(expires_at);
`;

export class MerchantDO extends DurableObject<MerchantEnv> {
  private sql: SqlStorage;
  private sessions: Map<WebSocket, { topics: Set<string> }> = new Map();
  private initialized = false;
  private migrated = false;

  constructor(ctx: DurableObjectState, env: MerchantEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    const statements = SCHEMA.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      this.sql.exec(stmt);
    }
    this.runMigrations();
    this.initialized = true;
  }

  private runMigrations(): void {
    if (this.migrated) return;
    const [row] = this.sql.exec(
      `SELECT value FROM config WHERE key = ?`,
      'schema_version'
    ).toArray() as { value: string }[];
    const version = row ? parseInt(row.value, 10) : 0;

    if (version < 1) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS costs (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        variant_id TEXT UNIQUE REFERENCES variants(id),
        cost_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      // Pre-computation tables for future materialized aggregation pipelines.
      // Currently unused — all analytics queries compute live from orders/inventory.
      // These tables exist to support scheduled rollups when the data volume grows.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS analytics_daily (
        date TEXT NOT NULL,
        total_revenue_cents INTEGER NOT NULL DEFAULT 0,
        total_cost_cents INTEGER NOT NULL DEFAULT 0,
        total_gross_profit_cents INTEGER NOT NULL DEFAULT 0,
        total_orders INTEGER NOT NULL DEFAULT 0,
        total_refunds_cents INTEGER NOT NULL DEFAULT 0,
        total_discounts_cents INTEGER NOT NULL DEFAULT 0,
        inventory_value_cents INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (date)
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS analytics_product (
        product_id TEXT NOT NULL,
        units_sold INTEGER NOT NULL DEFAULT 0,
        revenue_cents INTEGER NOT NULL DEFAULT 0,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        gross_profit_cents INTEGER NOT NULL DEFAULT 0,
        refund_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (product_id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_costs_product ON costs(product_id)`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_costs_variant ON costs(variant_id)`);
      this.sql.exec(
        `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('schema_version', '1', datetime('now'))`
      );
    }

    this.migrated = true;
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureInitialized();

    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, storage: 'sqlite' });
    }

    return new Response('Not found', { status: 404 });
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    this.ensureInitialized();
    const cursor = this.sql.exec(sql, ...params);
    return cursor.toArray() as T[];
  }

  run(sql: string, params: unknown[] = []): { changes: number } {
    this.ensureInitialized();
    this.sql.exec(sql, ...params);
    const [result] = this.sql.exec('SELECT changes() as changes').toArray() as [{ changes: number }];
    return { changes: result.changes };
  }

  private handleWebSocketUpgrade(request: Request): Response {
    const url = new URL(request.url);
    const topics = url.searchParams.get('topics')?.split(',') || ['*'];

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.sessions.set(server, { topics: new Set(topics) });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      const session = this.sessions.get(ws);
      if (!session) return;

      if (data.action === 'subscribe' && data.topic) {
        session.topics.add(data.topic);
      } else if (data.action === 'unsubscribe' && data.topic) {
        session.topics.delete(data.topic);
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  broadcast(event: WSEvent): void {
    const message = JSON.stringify(event);
    const eventTopic = event.type.split('.')[0];

    for (const [ws, session] of this.sessions) {
      if (session.topics.has('*') || session.topics.has(eventTopic) || session.topics.has(event.type)) {
        try {
          ws.send(message);
        } catch {
          this.sessions.delete(ws);
        }
      }
    }
  }

  async cleanupExpiredCarts(): Promise<number> {
    this.ensureInitialized();

    const now = new Date().toISOString();

    const expiredCarts = this.query<{ id: string }>(
      `SELECT id FROM carts WHERE status = 'open' AND expires_at < ?`,
      [now]
    );

    if (expiredCarts.length === 0) return 0;

    const cartIds = expiredCarts.map((c) => c.id);
    const placeholders = cartIds.map(() => '?').join(',');

    const reservedItems = this.query<{ sku: string; qty: number }>(
      `SELECT sku, SUM(qty) as qty FROM cart_items WHERE cart_id IN (${placeholders}) GROUP BY sku`,
      cartIds
    );

    for (const item of reservedItems) {
      this.run(`UPDATE inventory SET reserved = reserved - ? WHERE sku = ?`, [item.qty, item.sku]);
    }

    this.run(`UPDATE carts SET status = 'expired' WHERE id IN (${placeholders})`, cartIds);
    this.run(`DELETE FROM cart_items WHERE cart_id IN (${placeholders})`, cartIds);

    return expiredCarts.length;
  }
}
