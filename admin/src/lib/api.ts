import { getAuth } from './store';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { apiUrl, apiKey } = getAuth();

  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(
      err.error?.code || 'unknown',
      res.status,
      err.error?.message || res.statusText
    );
  }

  return res.json();
}

// Types
export type Order = {
  id: string;
  number?: string;
  status: 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'refunded' | 'canceled';
  customer_email: string;
  customer_id?: string | null;
  shipping?: {
    name: string | null;
    phone: string | null;
    address: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    } | null;
  } | null;
  amounts: {
    subtotal_cents: number;
    tax_cents: number;
    shipping_cents: number;
    total_cents: number;
    currency: string;
  };
  tracking?: {
    number: string | null;
    url: string | null;
    shipped_at: string | null;
  };
  stripe?: {
    checkout_session_id: string | null;
    payment_intent_id: string | null;
  };
  items: Array<{
    sku: string;
    title: string;
    qty: number;
    unit_price_cents: number;
  }>;
  created_at: string;
};

export type Customer = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  has_account: boolean;
  accepts_marketing: boolean;
  stats: {
    order_count: number;
    total_spent_cents: number;
    last_order_at: string | null;
  };
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type CustomerAddress = {
  id: string;
  label: string | null;
  is_default: boolean;
  name: string | null;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  country: string;
  phone: string | null;
};

export type Product = {
  id: string;
  title: string;
  description: string | null;
  status: 'active' | 'draft';
  created_at: string;
  variants: Variant[];
  categories: Array<{ id: string; name: string; slug: string }>;
  collections: Array<{ id: string; name: string; slug: string }>;
};

export type Variant = {
  id: string;
  sku: string;
  title: string;
  price_cents: number;
  image_url: string | null;
};

export type InventoryItem = {
  sku: string;
  on_hand: number;
  reserved: number;
  available: number;
  variant_title: string | null;
  product_title: string | null;
};

export type Webhook = {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'disabled';
  has_secret: boolean;
  created_at: string;
};

export type WebhookDetail = Webhook & {
  recent_deliveries: Array<{
    id: string;
    event_type: string;
    status: 'pending' | 'success' | 'failed';
    attempts: number;
    response_code: number | null;
    created_at: string;
    last_attempt_at: string | null;
  }>;
};

export type WebhookCreated = Webhook & {
  secret: string; // Only returned on creation
};

export type ProductProfitability = {
  product_id: string;
  product_title: string;
  product_status: string;
  variants_count: number;
  units_sold: number;
  revenue_cents: number;
  cost_cents: number;
  gross_profit_cents: number;
  gross_margin_bps: number;
  refund_cents: number;
  discount_cents: number;
  net_revenue_cents: number;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  parent_id: string | null;
  status: 'active' | 'draft';
  sort_order: number;
  product_count: number;
  created_at: string;
  updated_at: string;
};

export type Collection = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  status: 'active' | 'draft';
  sort_order: number;
  product_count: number;
  created_at: string;
  updated_at: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
  };
};

// API Methods
export const api = {
  // Orders
  async getOrders(params?: { limit?: number; cursor?: string; status?: string; email?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.email) searchParams.set('email', params.email);
    const query = searchParams.toString();
    return request<PaginatedResponse<Order>>(`/v1/orders${query ? `?${query}` : ''}`);
  },

  async getOrder(id: string) {
    return request<Order>(`/v1/orders/${id}`);
  },

  async updateOrder(
    id: string,
    data: { status?: string; tracking_number?: string; tracking_url?: string }
  ) {
    return request<Order>(`/v1/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async refundOrder(id: string, amount_cents?: number) {
    return request<{ stripe_refund_id: string; status: string }>(`/v1/orders/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify(amount_cents ? { amount_cents } : {}),
    });
  },

  // Products
  async getProducts(params?: { limit?: number; cursor?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<PaginatedResponse<Product>>(`/v1/products${query ? `?${query}` : ''}`);
  },

  async getProduct(id: string) {
    return request<Product>(`/v1/products/${id}`);
  },

  async createProduct(data: { title: string; description?: string }) {
    return request<Product>('/v1/products', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateProduct(id: string, data: { title?: string; description?: string; status?: string }) {
    return request<Product>(`/v1/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async createVariant(
    productId: string,
    data: { sku: string; title: string; price_cents: number; image_url?: string }
  ) {
    return request<Variant>(`/v1/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateVariant(
    productId: string,
    variantId: string,
    data: { sku?: string; title?: string; price_cents?: number; image_url?: string | null }
  ) {
    return request<Variant>(`/v1/products/${productId}/variants/${variantId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Inventory
  async getInventory() {
    return request<{ items: InventoryItem[] }>('/v1/inventory');
  },

  async adjustInventory(sku: string, data: { delta: number; reason: string }) {
    return request<InventoryItem>(`/v1/inventory/${encodeURIComponent(sku)}/adjust`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Images
  async uploadImage(file: File) {
    const { apiUrl, apiKey } = getAuth();
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${apiUrl}/v1/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        err.error?.code || 'unknown',
        res.status,
        err.error?.message || 'Upload failed'
      );
    }

    return res.json() as Promise<{ url: string; key: string }>;
  },

  // Webhooks
  async getWebhooks() {
    return request<{ items: Webhook[] }>('/v1/webhooks');
  },

  async getWebhook(id: string) {
    return request<WebhookDetail>(`/v1/webhooks/${id}`);
  },

  async createWebhook(data: { url: string; events: string[] }) {
    return request<WebhookCreated>('/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateWebhook(id: string, data: { url?: string; events?: string[]; status?: string }) {
    return request<Webhook>(`/v1/webhooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteWebhook(id: string) {
    return request<{ deleted: boolean }>(`/v1/webhooks/${id}`, {
      method: 'DELETE',
    });
  },

  async rotateWebhookSecret(id: string) {
    return request<{ secret: string }>(`/v1/webhooks/${id}/rotate-secret`, {
      method: 'POST',
    });
  },

  // Customers
  async getCustomers(params?: { limit?: number; cursor?: string; search?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.search) searchParams.set('search', params.search);
    const query = searchParams.toString();
    return request<PaginatedResponse<Customer>>(`/v1/customers${query ? `?${query}` : ''}`);
  },

  async getCustomer(id: string) {
    return request<Customer & { addresses: CustomerAddress[] }>(`/v1/customers/${id}`);
  },

  async getCustomerOrders(id: string, params?: { limit?: number; cursor?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    const query = searchParams.toString();
    return request<PaginatedResponse<Order>>(
      `/v1/customers/${id}/orders${query ? `?${query}` : ''}`
    );
  },

  async updateCustomer(
    id: string,
    data: {
      name?: string;
      phone?: string;
      accepts_marketing?: boolean;
      metadata?: Record<string, unknown>;
    }
  ) {
    return request<Customer>(`/v1/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Analytics types
  async getAnalyticsDashboard() {
    return request<{
      summary: {
        total_revenue_cents: number;
        total_cost_cents: number;
        gross_profit_cents: number;
        gross_margin_bps: number;
        total_orders: number;
        total_refunds_cents: number;
        total_discounts_cents: number;
        inventory_value_cents: number;
        unsold_inventory_cents: number;
      };
      top_products: ProductProfitability[];
      bottom_products: ProductProfitability[];
    }>('/v1/analytics/dashboard');
  },

  async getAnalyticsProducts(params?: { sort?: string; order?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.sort) searchParams.set('sort', params.sort);
    if (params?.order) searchParams.set('order', params.order);
    const query = searchParams.toString();
    return request<{
      items: ProductProfitability[];
      totals: { total_revenue_cents: number; total_cost_cents: number; total_profit_cents: number; total_units_sold: number };
    }>(`/v1/analytics/products${query ? `?${query}` : ''}`);
  },

  async getAnalyticsTrends(days?: number) {
    const query = days ? `?days=${days}` : '';
    return request<{
      items: Array<{
        date: string;
        revenue_cents: number;
        cost_cents: number;
        profit_cents: number;
        margin_bps: number;
        orders_count: number;
      }>;
    }>(`/v1/analytics/trends${query}`);
  },

  async getInventoryValuation() {
    return request<{
      items: Array<{
        sku: string;
        variant_title: string | null;
        product_title: string | null;
        on_hand: number;
        cost_cents: number;
        total_value_cents: number;
        potential_revenue_cents: number;
      }>;
      totals: { total_value_cents: number; total_potential_revenue_cents: number; total_on_hand: number };
    }>('/v1/analytics/inventory-valuation');
  },

  async setProductCost(productId: string, cost_cents: number) {
    return request<{ ok: boolean }>(`/v1/products/${productId}/cost`, {
      method: 'PATCH',
      body: JSON.stringify({ cost_cents }),
    });
  },

  async setVariantCost(productId: string, variantId: string, cost_cents: number) {
    return request<{ ok: boolean }>(`/v1/products/${productId}/variants/${variantId}/cost`, {
      method: 'PATCH',
      body: JSON.stringify({ cost_cents }),
    });
  },

  async getProductCosts(productId: string) {
    return request<{
      product_cost: { cost_cents: number; currency: string; updated_at: string } | null;
      variant_costs: Array<{ variant_id: string; sku: string; variant_title: string; cost_cents: number; currency: string; updated_at: string }>;
    }>(`/v1/products/${productId}/costs`);
  },

  // Health check (for login validation)
  async healthCheck() {
    return request<{ name: string; version: string; ok: boolean }>('/');
  },

  // Categories
  async getCategories(params?: { limit?: number; cursor?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<PaginatedResponse<Category>>(`/v1/categories${query ? `?${query}` : ''}`);
  },

  async getCategory(id: string) {
    return request<Category & { products: Array<{ id: string; title: string; status: string; image_url: string | null }> }>(`/v1/categories/${id}`);
  },

  async createCategory(data: { name: string; description?: string; image_url?: string; parent_id?: string; status?: string; sort_order?: number }) {
    return request<Category>('/v1/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCategory(id: string, data: { name?: string; description?: string; image_url?: string | null; parent_id?: string | null; status?: string; sort_order?: number }) {
    return request<Category>(`/v1/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteCategory(id: string) {
    return request<{ deleted: boolean }>(`/v1/categories/${id}`, {
      method: 'DELETE',
    });
  },

  async addCategoryProducts(id: string, product_ids: string[]) {
    return request<{ ok: boolean }>(`/v1/categories/${id}/products`, {
      method: 'POST',
      body: JSON.stringify({ product_ids }),
    });
  },

  async removeCategoryProduct(id: string, productId: string) {
    return request<{ ok: boolean }>(`/v1/categories/${id}/products/${productId}`, {
      method: 'DELETE',
    });
  },

  // Collections
  async getCollections(params?: { limit?: number; cursor?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<PaginatedResponse<Collection>>(`/v1/collections${query ? `?${query}` : ''}`);
  },

  async getCollection(id: string) {
    return request<Collection & { products: Array<{ id: string; title: string; status: string; image_url: string | null; sort_order: number }> }>(`/v1/collections/${id}`);
  },

  async createCollection(data: { name: string; description?: string; image_url?: string; status?: string; sort_order?: number }) {
    return request<Collection>('/v1/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCollection(id: string, data: { name?: string; description?: string; image_url?: string | null; status?: string; sort_order?: number }) {
    return request<Collection>(`/v1/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteCollection(id: string) {
    return request<{ deleted: boolean }>(`/v1/collections/${id}`, {
      method: 'DELETE',
    });
  },

  async addCollectionProducts(id: string, product_ids: string[]) {
    return request<{ ok: boolean }>(`/v1/collections/${id}/products`, {
      method: 'POST',
      body: JSON.stringify({ product_ids }),
    });
  },

  async removeCollectionProduct(id: string, productId: string) {
    return request<{ ok: boolean }>(`/v1/collections/${id}/products/${productId}`, {
      method: 'DELETE',
    });
  },

  async reorderCollectionProducts(id: string, items: Array<{ product_id: string; sort_order: number }>) {
    return request<{ ok: boolean }>(`/v1/collections/${id}/products/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
  },
};
