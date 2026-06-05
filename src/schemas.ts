import { z } from '@hono/zod-openapi';

// ============================================================
// COMMON SCHEMAS
// ============================================================

export const IdParam = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' }, example: '550e8400-e29b-41d4-a716-446655440000' }),
});

export const PaginationQuery = z.object({
  limit: z.string().optional().openapi({ param: { name: 'limit', in: 'query' }, example: '20' }),
  cursor: z.string().optional().openapi({ param: { name: 'cursor', in: 'query' } }),
});

export const PaginationResponse = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string().openapi({ example: 'invalid_request' }),
    message: z.string().openapi({ example: 'Invalid request parameters' }),
    details: z.record(z.unknown()).optional(),
  }),
}).openapi('Error');

// ============================================================
// VARIANT SCHEMAS
// ============================================================

export const VariantResponse = z.object({
  id: z.string().uuid(),
  sku: z.string().openapi({ example: 'TEE-BLK-M' }),
  title: z.string().openapi({ example: 'Black / Medium' }),
  price_cents: z.number().int().openapi({ example: 2999 }),
  image_url: z.string().nullable().openapi({ example: 'https://example.com/image.jpg' }),
}).openapi('Variant');

export const CreateVariantBody = z.object({
  sku: z.string().min(1).openapi({ example: 'TEE-BLK-M' }),
  title: z.string().min(1).openapi({ example: 'Black / Medium' }),
  price_cents: z.number().int().min(0).openapi({ example: 2999 }),
  image_url: z.string().url().optional().openapi({ example: 'https://example.com/image.jpg' }),
}).openapi('CreateVariant');

export const UpdateVariantBody = z.object({
  sku: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  price_cents: z.number().int().min(0).optional(),
  image_url: z.string().url().nullable().optional(),
}).openapi('UpdateVariant');

// ============================================================
// SHARED REFS
// ============================================================

export const CategoryRef = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
}).openapi('CategoryRef');

export const CollectionRef = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
}).openapi('CollectionRef');

// ============================================================
// PRODUCT SCHEMAS
// ============================================================

export const ProductStatus = z.enum(['active', 'draft']);

export const ProductResponse = z.object({
  id: z.string().uuid(),
  title: z.string().openapi({ example: 'Classic T-Shirt' }),
  description: z.string().nullable().openapi({ example: 'A comfortable cotton tee' }),
  status: ProductStatus,
  created_at: z.string().datetime(),
  variants: z.array(VariantResponse),
  categories: z.array(CategoryRef),
  collections: z.array(CollectionRef),
}).openapi('Product');

export const ProductListResponse = z.object({
  items: z.array(ProductResponse),
  pagination: PaginationResponse,
}).openapi('ProductList');

export const CreateProductBody = z.object({
  title: z.string().min(1).openapi({ example: 'Classic T-Shirt' }),
  description: z.string().optional().openapi({ example: 'A comfortable cotton tee' }),
}).openapi('CreateProduct');

export const UpdateProductBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: ProductStatus.optional(),
}).openapi('UpdateProduct');

export const ProductQuery = PaginationQuery.extend({
  status: ProductStatus.optional().openapi({ param: { name: 'status', in: 'query' } }),
});

// ============================================================
// INVENTORY SCHEMAS
// ============================================================

export const InventoryItem = z.object({
  sku: z.string().openapi({ example: 'TEE-BLK-M' }),
  on_hand: z.number().int().openapi({ example: 100 }),
  reserved: z.number().int().openapi({ example: 5 }),
  available: z.number().int().openapi({ example: 95 }),
}).openapi('InventoryItem');

export const InventoryItemWithDetails = InventoryItem.extend({
  variant_title: z.string().nullable().openapi({ example: 'Black / Medium' }),
  product_title: z.string().nullable().openapi({ example: 'Classic T-Shirt' }),
}).openapi('InventoryItemWithDetails');

export const InventoryListResponse = z.object({
  items: z.array(InventoryItemWithDetails),
  pagination: PaginationResponse,
}).openapi('InventoryList');

export const InventorySingleResponse = InventoryItemWithDetails.openapi('InventorySingle');

export const InventoryQuery = PaginationQuery.extend({
  sku: z.string().optional().openapi({ param: { name: 'sku', in: 'query' }, example: 'TEE-BLK-M' }),
  low_stock: z.string().optional().openapi({ param: { name: 'low_stock', in: 'query' } }),
});

export const AdjustmentReason = z.enum(['restock', 'correction', 'damaged', 'return']);

export const AdjustInventoryBody = z.object({
  delta: z.number().int().openapi({ example: 50, description: 'Positive to add, negative to subtract' }),
  reason: AdjustmentReason.openapi({ example: 'restock' }),
}).openapi('AdjustInventory');

export const SkuParam = z.object({
  sku: z.string().openapi({ param: { name: 'sku', in: 'path' }, example: 'TEE-BLK-M' }),
});

// ============================================================
// CART / CHECKOUT SCHEMAS
// ============================================================

export const CartItem = z.object({
  sku: z.string(),
  title: z.string(),
  qty: z.number().int().positive(),
  unit_price_cents: z.number().int(),
});

export const CartTotals = z.object({
  subtotal_cents: z.number().int(),
  discount_cents: z.number().int(),
  shipping_cents: z.number().int(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
});

export const CartDiscount = z.object({
  code: z.string(),
  type: z.enum(['percentage', 'fixed_amount']),
  amount_cents: z.number().int(),
}).nullable();

export const CartResponse = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'checked_out', 'expired']),
  currency: z.string().openapi({ example: 'USD' }),
  customer_email: z.string().email(),
  items: z.array(CartItem),
  discount: CartDiscount.optional(),
  totals: CartTotals.optional(),
  expires_at: z.string().datetime(),
  stripe_checkout_session_id: z.string().nullable().optional(),
}).openapi('Cart');

export const CreateCartBody = z.object({
  customer_email: z.string().email().openapi({ example: 'customer@example.com' }),
}).openapi('CreateCart');

export const AddCartItemsBody = z.object({
  items: z.array(z.object({
    sku: z.string().min(1).openapi({ example: 'TEE-BLK-M' }),
    qty: z.number().int().positive().openapi({ example: 2 }),
  })).min(1),
}).openapi('AddCartItems');

export const CheckoutBody = z.object({
  success_url: z.string().url().openapi({ example: 'https://example.com/success' }),
  cancel_url: z.string().url().openapi({ example: 'https://example.com/cancel' }),
  collect_shipping: z.boolean().optional().default(false),
  shipping_countries: z.array(z.string()).optional().default(['US']),
  shipping_options: z.array(z.any()).optional(),
}).openapi('Checkout');

export const CheckoutResponse = z.object({
  checkout_url: z.string().url(),
  stripe_checkout_session_id: z.string(),
}).openapi('CheckoutResult');

export const ApplyDiscountBody = z.object({
  code: z.string().min(1).openapi({ example: 'SAVE10' }),
}).openapi('ApplyDiscount');

export const ApplyDiscountResponse = z.object({
  discount: z.object({
    code: z.string(),
    type: z.enum(['percentage', 'fixed_amount']),
    amount_cents: z.number().int(),
  }),
  totals: CartTotals,
}).openapi('ApplyDiscountResult');

export const CartIdParam = z.object({
  cartId: z.string().uuid().openapi({ param: { name: 'cartId', in: 'path' } }),
});

// ============================================================
// ORDER SCHEMAS
// ============================================================

export const OrderStatus = z.enum(['pending', 'paid', 'processing', 'shipped', 'delivered', 'refunded', 'canceled']);

export const OrderItem = z.object({
  sku: z.string(),
  title: z.string(),
  qty: z.number().int(),
  unit_price_cents: z.number().int(),
});

export const ShippingAddress = z.object({
  line1: z.string(),
  line2: z.string().nullable().optional(),
  city: z.string(),
  state: z.string().nullable().optional(),
  postal_code: z.string(),
  country: z.string(),
}).nullable();

export const OrderResponse = z.object({
  id: z.string().uuid(),
  number: z.string().openapi({ example: 'ORD-241231-A7K2' }),
  status: OrderStatus,
  customer_email: z.string().email(),
  customer_id: z.string().uuid().nullable(),
  shipping: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    address: ShippingAddress,
  }),
  amounts: z.object({
    subtotal_cents: z.number().int(),
    discount_cents: z.number().int(),
    tax_cents: z.number().int(),
    shipping_cents: z.number().int(),
    total_cents: z.number().int(),
    currency: z.string(),
  }),
  discount: z.object({
    code: z.string(),
    amount_cents: z.number().int(),
  }).nullable(),
  tracking: z.object({
    number: z.string().nullable(),
    url: z.string().nullable(),
    shipped_at: z.string().nullable(),
  }),
  stripe: z.object({
    checkout_session_id: z.string().nullable(),
    payment_intent_id: z.string().nullable(),
  }),
  items: z.array(OrderItem),
  created_at: z.string().datetime(),
}).openapi('Order');

export const OrderListResponse = z.object({
  items: z.array(OrderResponse),
  pagination: PaginationResponse,
}).openapi('OrderList');

export const OrderQuery = PaginationQuery.extend({
  status: OrderStatus.optional().openapi({ param: { name: 'status', in: 'query' } }),
  email: z.string().email().optional().openapi({ param: { name: 'email', in: 'query' } }),
});

export const UpdateOrderBody = z.object({
  status: OrderStatus.optional(),
  tracking_number: z.string().nullable().optional(),
  tracking_url: z.string().url().nullable().optional(),
}).openapi('UpdateOrder');

export const RefundOrderBody = z.object({
  amount_cents: z.number().int().positive().optional().openapi({ description: 'Omit for full refund' }),
}).openapi('RefundOrder');

export const RefundResponse = z.object({
  stripe_refund_id: z.string(),
  status: z.string(),
}).openapi('RefundResult');

export const CreateTestOrderBody = z.object({
  customer_email: z.string().email().openapi({ example: 'test@example.com' }),
  items: z.array(z.object({
    sku: z.string(),
    qty: z.number().int().positive(),
  })).min(1),
  discount_code: z.string().optional(),
}).openapi('CreateTestOrder');

export const OrderIdParam = z.object({
  orderId: z.string().uuid().openapi({ param: { name: 'orderId', in: 'path' } }),
});

// ============================================================
// CUSTOMER SCHEMAS
// ============================================================

export const CustomerResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  has_account: z.boolean(),
  accepts_marketing: z.boolean(),
  stats: z.object({
    order_count: z.number().int(),
    total_spent_cents: z.number().int(),
    last_order_at: z.string().datetime().nullable(),
  }),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).openapi('Customer');

export const CustomerWithAddresses = CustomerResponse.extend({
  addresses: z.array(z.object({
    id: z.string().uuid(),
    label: z.string().nullable(),
    is_default: z.boolean(),
    name: z.string().nullable(),
    company: z.string().nullable(),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    state: z.string().nullable(),
    postal_code: z.string(),
    country: z.string(),
    phone: z.string().nullable(),
  })),
}).openapi('CustomerWithAddresses');

export const CustomerListResponse = z.object({
  items: z.array(CustomerResponse),
  pagination: PaginationResponse,
}).openapi('CustomerList');

export const CustomerQuery = PaginationQuery.extend({
  search: z.string().optional().openapi({ param: { name: 'search', in: 'query' } }),
});

export const UpdateCustomerBody = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  accepts_marketing: z.boolean().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
}).openapi('UpdateCustomer');

export const CreateAddressBody = z.object({
  label: z.string().optional(),
  is_default: z.boolean().optional(),
  name: z.string().optional(),
  company: z.string().optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postal_code: z.string().min(1),
  country: z.string().optional().default('US'),
  phone: z.string().optional(),
}).openapi('CreateAddress');

export const AddressResponse = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  is_default: z.boolean(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string().nullable(),
  postal_code: z.string(),
  country: z.string(),
  phone: z.string().nullable(),
}).openapi('Address');

export const AddressIdParam = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }),
  addressId: z.string().uuid().openapi({ param: { name: 'addressId', in: 'path' } }),
});

// ============================================================
// DISCOUNT SCHEMAS
// ============================================================

export const DiscountType = z.enum(['percentage', 'fixed_amount']);
export const DiscountStatus = z.enum(['active', 'inactive']);

export const DiscountResponse = z.object({
  id: z.string().uuid(),
  code: z.string().nullable().openapi({ example: 'SAVE20' }),
  type: DiscountType,
  value: z.number().int().openapi({ example: 20, description: 'Percentage (0-100) or cents' }),
  status: DiscountStatus,
  min_purchase_cents: z.number().int(),
  max_discount_cents: z.number().int().nullable(),
  starts_at: z.string().datetime().nullable(),
  expires_at: z.string().datetime().nullable(),
  usage_limit: z.number().int().nullable(),
  usage_limit_per_customer: z.number().int().nullable(),
  usage_count: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
}).openapi('Discount');

export const DiscountListResponse = z.object({
  items: z.array(DiscountResponse),
}).openapi('DiscountList');

export const CreateDiscountBody = z.object({
  code: z.string().optional().openapi({ example: 'SAVE20' }),
  type: DiscountType,
  value: z.number().int().min(0).openapi({ example: 20 }),
  min_purchase_cents: z.number().int().min(0).optional(),
  max_discount_cents: z.number().int().positive().optional(),
  starts_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  usage_limit: z.number().int().positive().optional(),
  usage_limit_per_customer: z.number().int().positive().optional(),
}).openapi('CreateDiscount');

export const UpdateDiscountBody = z.object({
  status: DiscountStatus.optional(),
  code: z.string().nullable().optional(),
  value: z.number().int().min(0).optional(),
  min_purchase_cents: z.number().int().min(0).optional(),
  max_discount_cents: z.number().int().positive().nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  usage_limit: z.number().int().positive().nullable().optional(),
  usage_limit_per_customer: z.number().int().positive().nullable().optional(),
}).openapi('UpdateDiscount');

// ============================================================
// WEBHOOK SCHEMAS
// ============================================================

export const WebhookEvent = z.enum([
  'order.created',
  'order.updated',
  'order.shipped',
  'order.refunded',
  'inventory.low',
  'order.*',
  '*',
]);

export const WebhookStatus = z.enum(['active', 'disabled']);

export const WebhookResponse = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  events: z.array(z.string()),
  status: WebhookStatus,
  has_secret: z.boolean(),
  created_at: z.string().datetime(),
}).openapi('Webhook');

export const WebhookWithSecret = WebhookResponse.extend({
  secret: z.string().openapi({ example: 'whsec_abc123...' }),
}).omit({ has_secret: true }).openapi('WebhookWithSecret');

export const WebhookListResponse = z.object({
  items: z.array(WebhookResponse),
}).openapi('WebhookList');

export const WebhookDetailResponse = WebhookResponse.extend({
  recent_deliveries: z.array(z.object({
    id: z.string().uuid(),
    event_type: z.string(),
    status: z.enum(['pending', 'success', 'failed']),
    attempts: z.number().int(),
    response_code: z.number().int().nullable(),
    created_at: z.string().datetime(),
    last_attempt_at: z.string().datetime().nullable(),
  })),
}).openapi('WebhookDetail');

export const CreateWebhookBody = z.object({
  url: z.string().url().openapi({ example: 'https://example.com/webhook' }),
  events: z.array(WebhookEvent).min(1).openapi({ example: ['order.created', 'order.shipped'] }),
}).openapi('CreateWebhook');

export const UpdateWebhookBody = z.object({
  url: z.string().url().optional(),
  events: z.array(WebhookEvent).min(1).optional(),
  status: WebhookStatus.optional(),
}).openapi('UpdateWebhook');

export const WebhookDeliveryResponse = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  payload: z.record(z.unknown()),
  status: z.enum(['pending', 'success', 'failed']),
  attempts: z.number().int(),
  response_code: z.number().int().nullable(),
  response_body: z.string().nullable(),
  created_at: z.string().datetime(),
  last_attempt_at: z.string().datetime().nullable(),
}).openapi('WebhookDelivery');

export const DeliveryIdParam = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }),
  deliveryId: z.string().uuid().openapi({ param: { name: 'deliveryId', in: 'path' } }),
});

export const RotateSecretResponse = z.object({
  secret: z.string(),
}).openapi('RotateSecretResult');

export const RetryResponse = z.object({
  status: z.string(),
  message: z.string(),
}).openapi('RetryResult');

// ============================================================
// SETUP SCHEMAS
// ============================================================

export const SetupStripeBody = z.object({
  stripe_secret_key: z.string().startsWith('sk_').openapi({ example: 'sk_test_...' }),
  stripe_webhook_secret: z.string().startsWith('whsec_').optional().openapi({ example: 'whsec_...' }),
}).openapi('SetupStripe');

export const OkResponse = z.object({
  ok: z.literal(true),
}).openapi('Ok');

export const DeletedResponse = z.object({
  deleted: z.literal(true),
}).openapi('Deleted');

// ============================================================
// IMAGE SCHEMAS
// ============================================================

export const ImageUploadResponse = z.object({
  url: z.string().url(),
  key: z.string(),
}).openapi('ImageUpload');

// ============================================================
// ANALYTICS / FINANCIAL SCHEMAS
// ============================================================

export const SetCostBody = z.object({
  cost_cents: z.number().int().min(0).openapi({ example: 1500, description: 'Cost in minor currency units (cents)' }),
}).openapi('SetCost');

export const CostResponse = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  cost_cents: z.number().int(),
  currency: z.string(),
  updated_at: z.string().datetime(),
}).openapi('Cost');

export const AnalyticsSummary = z.object({
  total_revenue_cents: z.number().int(),
  total_cost_cents: z.number().int(),
  gross_profit_cents: z.number().int(),
  gross_margin_bps: z.number().int(),
  total_orders: z.number().int(),
  total_refunds_cents: z.number().int(),
  total_discounts_cents: z.number().int(),
  inventory_value_cents: z.number().int(),
  unsold_inventory_cents: z.number().int(),
}).openapi('AnalyticsSummary');

export const ProductProfitability = z.object({
  product_id: z.string().uuid(),
  product_title: z.string(),
  product_status: z.string(),
  variants_count: z.number().int(),
  units_sold: z.number().int(),
  revenue_cents: z.number().int(),
  cost_cents: z.number().int(),
  gross_profit_cents: z.number().int(),
  gross_margin_bps: z.number().int(),
  refund_cents: z.number().int(),
  discount_cents: z.number().int(),
  net_revenue_cents: z.number().int(),
}).openapi('ProductProfitability');

export const ProductProfitabilityList = z.object({
  items: z.array(ProductProfitability),
  totals: z.object({
    total_revenue_cents: z.number().int(),
    total_cost_cents: z.number().int(),
    total_profit_cents: z.number().int(),
    total_units_sold: z.number().int(),
  }),
}).openapi('ProductProfitabilityList');

export const TrendDataPoint = z.object({
  date: z.string(),
  revenue_cents: z.number().int(),
  cost_cents: z.number().int(),
  profit_cents: z.number().int(),
  margin_bps: z.number().int(),
  orders_count: z.number().int(),
}).openapi('TrendDataPoint');

export const TrendResponse = z.object({
  items: z.array(TrendDataPoint),
}).openapi('TrendResponse');

export const InventoryValuationItem = z.object({
  sku: z.string(),
  variant_title: z.string().nullable(),
  product_title: z.string().nullable(),
  on_hand: z.number().int(),
  cost_cents: z.number().int(),
  total_value_cents: z.number().int(),
  potential_revenue_cents: z.number().int(),
}).openapi('InventoryValuationItem');

export const InventoryValuationResponse = z.object({
  items: z.array(InventoryValuationItem),
  totals: z.object({
    total_value_cents: z.number().int(),
    total_potential_revenue_cents: z.number().int(),
    total_on_hand: z.number().int(),
  }),
}).openapi('InventoryValuationResponse');

export const AnalyticsOrderProfitability = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  status: z.string(),
  customer_email: z.string(),
  revenue_cents: z.number().int(),
  cost_cents: z.number().int(),
  gross_profit_cents: z.number().int(),
  gross_margin_bps: z.number().int(),
  discount_cents: z.number().int(),
  refund_cents: z.number().int(),
  net_profit_cents: z.number().int(),
  created_at: z.string().datetime(),
}).openapi('OrderProfitability');

export const AnalyticsDashboardResponse = z.object({
  summary: AnalyticsSummary,
  top_products: z.array(ProductProfitability),
  bottom_products: z.array(ProductProfitability),
}).openapi('AnalyticsDashboardResponse');

export const AnalyticsQuery = z.object({
  days: z.string().optional().openapi({ param: { name: 'days', in: 'query' }, example: '30' }),
  sort: z.enum(['profit', 'revenue', 'margin', 'units']).optional().openapi({ param: { name: 'sort', in: 'query' } }),
  order: z.enum(['desc', 'asc']).optional().openapi({ param: { name: 'order', in: 'query' } }),
});

// ============================================================
// CATEGORY SCHEMAS
// ============================================================

export const CategoryStatus = z.enum(['active', 'draft']);

export const CategoryResponse = z.object({
  id: z.string().uuid(),
  name: z.string().openapi({ example: 'T-Shirts' }),
  slug: z.string().openapi({ example: 't-shirts' }),
  description: z.string().nullable().openapi({ example: 'All our t-shirt products' }),
  image_url: z.string().nullable(),
  parent_id: z.string().uuid().nullable(),
  status: CategoryStatus,
  sort_order: z.number().int(),
  product_count: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).openapi('Category');

export const CategoryListResponse = z.object({
  items: z.array(CategoryResponse),
  pagination: PaginationResponse,
}).openapi('CategoryList');

export const CreateCategoryBody = z.object({
  name: z.string().min(1).openapi({ example: 'T-Shirts' }),
  description: z.string().optional().openapi({ example: 'All our t-shirt products' }),
  image_url: z.string().url().optional(),
  parent_id: z.string().uuid().optional(),
  status: CategoryStatus.optional(),
  sort_order: z.number().int().optional(),
}).openapi('CreateCategory');

export const UpdateCategoryBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  status: CategoryStatus.optional(),
  sort_order: z.number().int().optional(),
}).openapi('UpdateCategory');

export const CategoryQuery = PaginationQuery.extend({
  status: CategoryStatus.optional().openapi({ param: { name: 'status', in: 'query' } }),
});

export const CategoryDetailResponse = CategoryResponse.extend({
  products: z.array(z.object({
    id: z.string().uuid(),
    title: z.string(),
    status: ProductStatus,
    image_url: z.string().nullable(),
  })),
}).openapi('CategoryDetail');

export const CategoryIdParam = z.object({
  categoryId: z.string().uuid().openapi({ param: { name: 'categoryId', in: 'path' } }),
});

export const ManageCategoryProductsBody = z.object({
  product_ids: z.array(z.string().uuid()).min(1).openapi({ example: ['550e8400-e29b-41d4-a716-446655440000'] }),
}).openapi('ManageCategoryProducts');

// ============================================================
// COLLECTION SCHEMAS
// ============================================================

export const CollectionStatus = z.enum(['active', 'draft']);

export const CollectionResponse = z.object({
  id: z.string().uuid(),
  name: z.string().openapi({ example: 'Summer Collection' }),
  slug: z.string().openapi({ example: 'summer-collection' }),
  description: z.string().nullable().openapi({ example: 'Hot summer picks' }),
  image_url: z.string().nullable(),
  status: CollectionStatus,
  sort_order: z.number().int(),
  product_count: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).openapi('Collection');

export const CollectionListResponse = z.object({
  items: z.array(CollectionResponse),
  pagination: PaginationResponse,
}).openapi('CollectionList');

export const CreateCollectionBody = z.object({
  name: z.string().min(1).openapi({ example: 'Summer Collection' }),
  description: z.string().optional().openapi({ example: 'Hot summer picks' }),
  image_url: z.string().url().optional(),
  status: CollectionStatus.optional(),
  sort_order: z.number().int().optional(),
}).openapi('CreateCollection');

export const UpdateCollectionBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  status: CollectionStatus.optional(),
  sort_order: z.number().int().optional(),
}).openapi('UpdateCollection');

export const CollectionQuery = PaginationQuery.extend({
  status: CollectionStatus.optional().openapi({ param: { name: 'status', in: 'query' } }),
});

export const CollectionDetailResponse = CollectionResponse.extend({
  products: z.array(z.object({
    id: z.string().uuid(),
    title: z.string(),
    status: ProductStatus,
    image_url: z.string().nullable(),
    sort_order: z.number().int(),
  })),
}).openapi('CollectionDetail');

export const CollectionIdParam = z.object({
  collectionId: z.string().uuid().openapi({ param: { name: 'collectionId', in: 'path' } }),
});

export const ManageCollectionProductsBody = z.object({
  product_ids: z.array(z.string().uuid()).min(1).openapi({ example: ['550e8400-e29b-41d4-a716-446655440000'] }),
}).openapi('ManageCollectionProducts');

export const ReorderCollectionProductsBody = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    sort_order: z.number().int().min(0),
  })).min(1),
}).openapi('ReorderCollectionProducts');

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Product = z.infer<typeof ProductResponse>;
export type Variant = z.infer<typeof VariantResponse>;
export type Order = z.infer<typeof OrderResponse>;
export type Customer = z.infer<typeof CustomerResponse>;
export type Discount = z.infer<typeof DiscountResponse>;
export type Webhook = z.infer<typeof WebhookResponse>;
export type InventoryItemType = z.infer<typeof InventoryItem>;
export type CartType = z.infer<typeof CartResponse>;
export type CostResponseType = z.infer<typeof CostResponse>;
export type AnalyticsSummaryType = z.infer<typeof AnalyticsSummary>;
export type ProductProfitabilityType = z.infer<typeof ProductProfitability>;
export type TrendDataPointType = z.infer<typeof TrendDataPoint>;
export type InventoryValuationItemType = z.infer<typeof InventoryValuationItem>;
export type Category = z.infer<typeof CategoryResponse>;
export type Collection = z.infer<typeof CollectionResponse>;
