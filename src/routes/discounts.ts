import { Hono } from 'hono';
import Stripe from 'stripe';
import { getDb, type Database } from '../db';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { ApiError, uuid, now, type Env, type AuthContext } from '../types';

// ============================================================
// DISCOUNT ROUTES
// ============================================================

const discountRoutes = new Hono<{
  Bindings: Env;
  Variables: { auth: AuthContext };
}>();

discountRoutes.use('*', authMiddleware);

// ============================================================
// DISCOUNT VALIDATION & CALCULATION
// ============================================================

type DiscountType = 'percentage' | 'fixed_amount';

export interface Discount {
  id: string;
  store_id: string;
  code: string | null;
  type: DiscountType;
  value: number;
  status: string;
  min_purchase_cents: number;
  max_discount_cents: number | null;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  usage_limit_per_customer: number | null;
  usage_count: number;
  stripe_coupon_id: string | null;
  stripe_promotion_code_id: string | null;
}

export async function validateDiscount(
  db: Database,
  discount: Discount,
  subtotalCents: number,
  customerEmail?: string
): Promise<void> {
  if (discount.status !== 'active') {
    throw ApiError.invalidRequest('Discount is not active');
  }

  const currentTime = now();
  if (discount.starts_at && currentTime < discount.starts_at) {
    throw ApiError.invalidRequest('Discount has not started yet');
  }
  if (discount.expires_at && currentTime > discount.expires_at) {
    throw ApiError.invalidRequest('Discount has expired');
  }

  if (discount.min_purchase_cents > 0 && subtotalCents < discount.min_purchase_cents) {
    throw ApiError.invalidRequest(
      `Minimum purchase of $${(discount.min_purchase_cents / 100).toFixed(2)} required`
    );
  }

  if (discount.usage_limit !== null && discount.usage_count >= discount.usage_limit) {
    throw ApiError.invalidRequest('Discount usage limit reached');
  }

  // Check per-customer usage limit
  if (customerEmail && discount.usage_limit_per_customer !== null) {
    const [usage] = await db.query<any>(
      `SELECT COUNT(*) as count FROM discount_usage WHERE discount_id = ? AND customer_email = ?`,
      [discount.id, customerEmail.toLowerCase()]
    );
    if (usage && usage.count >= discount.usage_limit_per_customer) {
      throw ApiError.invalidRequest('You have already used this discount');
    }
  }
}

export function calculateDiscount(
  discount: Discount,
  subtotalCents: number
): number {
  switch (discount.type) {
    case 'percentage': {
      let amount = Math.floor((subtotalCents * discount.value) / 100);
      if (discount.max_discount_cents !== null && amount > discount.max_discount_cents) {
        amount = discount.max_discount_cents;
      }
      return amount;
    }
    case 'fixed_amount': {
      return Math.min(discount.value, subtotalCents);
    }
    default:
      return 0;
  }
}

/**
 * Sync discount to Stripe as coupon and promotion code
 * Merchant stays source of truth - Stripe is just for checkout display
 */
async function syncDiscountToStripe(
  stripeSecretKey: string | null,
  discount: {
    id: string;
    code: string | null;
    type: DiscountType;
    value: number;
    max_discount_cents: number | null;
    expires_at: string | null;
    status?: string;
    stripe_coupon_id: string | null;
    stripe_promotion_code_id: string | null;
  }
): Promise<{ couponId: string | null; promotionCodeId: string | null; syncError?: string }> {
  if (!stripeSecretKey) {
    // Stripe not connected, return nulls
    return { couponId: null, promotionCodeId: null };
  }

  const stripe = new Stripe(stripeSecretKey);

  try {
    // Create or update Stripe coupon
    let couponId = discount.stripe_coupon_id;
    
    const couponParams: Stripe.CouponCreateParams = {
      duration: 'once',
      metadata: { merchant_discount_id: discount.id },
    };

    if (discount.type === 'percentage') {
      // For percentage discounts with a max_discount_cents cap, we cannot use percent_off
      // because Stripe doesn't enforce the cap. The actual discount amount depends on
      // the order subtotal, so we must create the coupon on-the-fly at checkout time.
      // Return null here - the coupon will be created in checkout.ts with the correct amount.
      if (discount.max_discount_cents) {
        // Don't create Stripe coupon here - it will be created on-the-fly at checkout
        // with the correct capped amount based on the actual order subtotal
        return { couponId: null, promotionCodeId: null };
      }
      couponParams.percent_off = discount.value;
    } else {
      couponParams.amount_off = discount.value;
      couponParams.currency = 'usd';
    }

    if (discount.expires_at) {
      couponParams.redeem_by = Math.floor(new Date(discount.expires_at).getTime() / 1000);
    }

    if (couponId) {
      // Update existing coupon (Stripe doesn't support updating, so we delete and recreate)
      try {
        await stripe.coupons.del(couponId);
      } catch {
        // Coupon might not exist, continue
      }
      couponId = null;
    }

    const coupon = await stripe.coupons.create(couponParams);
    couponId = coupon.id;

    // Create or update promotion code if discount has a code
    let promotionCodeId = discount.stripe_promotion_code_id;
    const isActive = discount.status !== 'inactive';
    
    if (discount.code && isActive) {
      // Discount has code and is active - create or recreate promotion code
      // (Stripe doesn't support updating promotion codes, so we deactivate old and create new)
      if (promotionCodeId) {
        try {
          await stripe.promotionCodes.update(promotionCodeId, { active: false });
        } catch {
          // Promotion code might not exist, continue
        }
      }
      
      // Create new active promotion code
      const promotionCode = await stripe.promotionCodes.create({
        coupon: couponId,
        code: discount.code.toUpperCase(),
        active: true,
        metadata: { merchant_discount_id: discount.id },
      });
      promotionCodeId = promotionCode.id;
    } else if (promotionCodeId) {
      // Discount is inactive or has no code - deactivate existing promotion code
      // Keep ID in DB for reference
      try {
        await stripe.promotionCodes.update(promotionCodeId, { active: false });
      } catch {
        // Promotion code might not exist, ignore
      }
      // Keep promotionCodeId (don't set to null) so we have reference to deactivated code
    }
    // If no code and no existing promotion code, promotionCodeId stays null

    return { couponId, promotionCodeId };
  } catch (err: any) {
    // If Stripe sync fails, log but don't fail discount creation
    // Merchant is source of truth, Stripe is optional
    const errorMessage = err.message || 'Unknown error';
    console.error('Failed to sync discount to Stripe:', errorMessage);
    return { 
      couponId: discount.stripe_coupon_id, 
      promotionCodeId: discount.stripe_promotion_code_id,
      syncError: errorMessage 
    };
  }
}

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// GET /v1/discounts
discountRoutes.get('/', adminOnly, async (c) => {
  const { store } = c.get('auth');
  const db = getDb(c.env);

  const discounts = await db.query<any>(
    `SELECT * FROM discounts WHERE store_id = ? ORDER BY created_at DESC`,
    [store.id]
  );

  return c.json({
    items: discounts.map((d) => ({
      id: d.id,
      code: d.code,
      type: d.type,
      value: d.value,
      status: d.status,
      min_purchase_cents: d.min_purchase_cents,
      max_discount_cents: d.max_discount_cents,
      starts_at: d.starts_at,
      expires_at: d.expires_at,
      usage_limit: d.usage_limit,
      usage_limit_per_customer: d.usage_limit_per_customer,
      usage_count: d.usage_count,
      created_at: d.created_at,
    })),
  });
});

// GET /v1/discounts/:id
discountRoutes.get('/:id', adminOnly, async (c) => {
  const id = c.req.param('id');
  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [discount] = await db.query<any>(
    `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
    [id, store.id]
  );

  if (!discount) throw ApiError.notFound('Discount not found');

  return c.json({
    id: discount.id,
    code: discount.code,
    type: discount.type,
    value: discount.value,
    status: discount.status,
    min_purchase_cents: discount.min_purchase_cents,
    max_discount_cents: discount.max_discount_cents,
    starts_at: discount.starts_at,
    expires_at: discount.expires_at,
    usage_limit: discount.usage_limit,
    usage_limit_per_customer: discount.usage_limit_per_customer,
    usage_count: discount.usage_count,
    created_at: discount.created_at,
    updated_at: discount.updated_at,
  });
});

// POST /v1/discounts
discountRoutes.post('/', adminOnly, async (c) => {
  const body = await c.req.json();
  const {
    code,
    type,
    value,
    min_purchase_cents,
    max_discount_cents,
    starts_at,
    expires_at,
    usage_limit,
    usage_limit_per_customer,
  } = body;

  if (!type || !['percentage', 'fixed_amount'].includes(type)) {
    throw ApiError.invalidRequest('type must be percentage or fixed_amount');
  }
  if (typeof value !== 'number' || value < 0) {
    throw ApiError.invalidRequest('value must be a non-negative number');
  }
  if (type === 'percentage' && (value < 0 || value > 100)) {
    throw ApiError.invalidRequest('percentage value must be between 0 and 100');
  }
  if (code && typeof code !== 'string') {
    throw ApiError.invalidRequest('code must be a string');
  }

  const { store } = c.get('auth');
  const db = getDb(c.env);

  // Normalize code to uppercase for consistent lookups
  const normalizedCode = code ? code.toUpperCase().trim() : null;

  // Check code uniqueness if provided
  if (normalizedCode) {
    const [existing] = await db.query<any>(
      `SELECT id FROM discounts WHERE code = ? AND store_id = ?`,
      [normalizedCode, store.id]
    );
    if (existing) throw ApiError.conflict(`Discount code ${normalizedCode} already exists`);
  }

  const id = uuid();
  const timestamp = now();

  // Sync to Stripe if connected
  let stripeCouponId = null;
  let stripePromotionCodeId = null;
  
  if (store.stripe_secret_key) {
    const stripeSync = await syncDiscountToStripe(store.stripe_secret_key, {
      id,
      code: normalizedCode,
      type,
      value,
      max_discount_cents: max_discount_cents || null,
      expires_at: expires_at || null,
      status: 'active', // New discounts are active by default
      stripe_coupon_id: null,
      stripe_promotion_code_id: null,
    });
    stripeCouponId = stripeSync.couponId;
    stripePromotionCodeId = stripeSync.promotionCodeId;
    
    // Log warning if Stripe sync failed but don't fail discount creation
    if (stripeSync.syncError) {
      console.warn(`Discount ${id} created but Stripe sync failed:`, stripeSync.syncError);
    }
  }

  await db.run(
    `INSERT INTO discounts (id, store_id, code, type, value, min_purchase_cents, max_discount_cents, starts_at, expires_at, usage_limit, usage_limit_per_customer, stripe_coupon_id, stripe_promotion_code_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      store.id,
      normalizedCode,
      type,
      value,
      min_purchase_cents || 0,
      max_discount_cents || null,
      starts_at || null,
      expires_at || null,
      usage_limit ?? null,
      usage_limit_per_customer ?? null,
      stripeCouponId,
      stripePromotionCodeId,
      timestamp,
      timestamp,
    ]
  );

  const [discount] = await db.query<any>(
    `SELECT * FROM discounts WHERE id = ?`,
    [id]
  );

  return c.json(
    {
      id: discount.id,
      code: discount.code,
      type: discount.type,
      value: discount.value,
      status: discount.status,
      min_purchase_cents: discount.min_purchase_cents,
      max_discount_cents: discount.max_discount_cents,
      starts_at: discount.starts_at,
      expires_at: discount.expires_at,
      usage_limit: discount.usage_limit,
      usage_limit_per_customer: discount.usage_limit_per_customer,
      usage_count: discount.usage_count,
      created_at: discount.created_at,
    },
    201
  );
});

// PATCH /v1/discounts/:id
discountRoutes.patch('/:id', adminOnly, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status, code, value, min_purchase_cents, max_discount_cents, starts_at, expires_at, usage_limit, usage_limit_per_customer } = body;

  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [existing] = await db.query<any>(
    `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
    [id, store.id]
  );
  if (!existing) throw ApiError.notFound('Discount not found');

  const updates: string[] = [];
  const params: unknown[] = [];

  if (status !== undefined) {
    if (!['active', 'inactive'].includes(status)) {
      throw ApiError.invalidRequest('status must be active or inactive');
    }
    updates.push('status = ?');
    params.push(status);
  }
  if (code !== undefined) {
    if (code && typeof code !== 'string') {
      throw ApiError.invalidRequest('code must be a string');
    }
    // Normalize code to uppercase
    const normalizedCode = code ? code.toUpperCase().trim() : null;
    // Check uniqueness if changing code
    if (normalizedCode && normalizedCode !== existing.code) {
      const [duplicate] = await db.query<any>(
        `SELECT id FROM discounts WHERE code = ? AND store_id = ? AND id != ?`,
        [normalizedCode, store.id, id]
      );
      if (duplicate) throw ApiError.conflict(`Discount code ${normalizedCode} already exists`);
    }
    updates.push('code = ?');
    params.push(normalizedCode);
  }
  if (value !== undefined) {
    if (typeof value !== 'number' || value < 0) {
      throw ApiError.invalidRequest('value must be a non-negative number');
    }
    // Validate percentage range based on existing or unchanged type
    if (existing.type === 'percentage' && (value < 0 || value > 100)) {
      throw ApiError.invalidRequest('percentage value must be between 0 and 100');
    }
    updates.push('value = ?');
    params.push(value);
  }
  if (min_purchase_cents !== undefined) {
    updates.push('min_purchase_cents = ?');
    params.push(min_purchase_cents);
  }
  if (max_discount_cents !== undefined) {
    updates.push('max_discount_cents = ?');
    params.push(max_discount_cents || null);
  }
  if (starts_at !== undefined) {
    updates.push('starts_at = ?');
    params.push(starts_at || null);
  }
  if (expires_at !== undefined) {
    updates.push('expires_at = ?');
    params.push(expires_at || null);
  }
  if (usage_limit !== undefined) {
    updates.push('usage_limit = ?');
    params.push(usage_limit ?? null);
  }
  if (usage_limit_per_customer !== undefined) {
    updates.push('usage_limit_per_customer = ?');
    params.push(usage_limit_per_customer ?? null);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(now());
    params.push(id);
    params.push(store.id);

    await db.run(
      `UPDATE discounts SET ${updates.join(', ')} WHERE id = ? AND store_id = ?`,
      params
    );
  }

  const [discount] = await db.query<any>(
    `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
    [id, store.id]
  );

  // Sync to Stripe if any Stripe-relevant fields changed
  // (code, value, type, max_discount_cents, expires_at, status)
  const stripeRelevantFields = ['code', 'value', 'max_discount_cents', 'expires_at', 'status'];
  const shouldSyncStripe = updates.some(update => 
    stripeRelevantFields.some(field => update.includes(field))
  );

  if (shouldSyncStripe && store.stripe_secret_key) {
    const stripeSync = await syncDiscountToStripe(store.stripe_secret_key, {
      id: discount.id,
      code: discount.code,
      type: discount.type,
      value: discount.value,
      max_discount_cents: discount.max_discount_cents,
      expires_at: discount.expires_at,
      status: discount.status,
      stripe_coupon_id: discount.stripe_coupon_id,
      stripe_promotion_code_id: discount.stripe_promotion_code_id,
    });
    
    // Log warning if Stripe sync failed but don't fail discount update
    if (stripeSync.syncError) {
      console.warn(`Discount ${discount.id} updated but Stripe sync failed:`, stripeSync.syncError);
    }
    
    // Update Stripe IDs if they changed
    if (stripeSync.couponId !== discount.stripe_coupon_id || 
        stripeSync.promotionCodeId !== discount.stripe_promotion_code_id) {
      await db.run(
        `UPDATE discounts SET stripe_coupon_id = ?, stripe_promotion_code_id = ? WHERE id = ?`,
        [stripeSync.couponId, stripeSync.promotionCodeId, discount.id]
      );
      discount.stripe_coupon_id = stripeSync.couponId;
      discount.stripe_promotion_code_id = stripeSync.promotionCodeId;
    }
  }

  return c.json({
    id: discount.id,
    code: discount.code,
    type: discount.type,
    value: discount.value,
    status: discount.status,
    min_purchase_cents: discount.min_purchase_cents,
    max_discount_cents: discount.max_discount_cents,
    starts_at: discount.starts_at,
    expires_at: discount.expires_at,
    usage_limit: discount.usage_limit,
    usage_limit_per_customer: discount.usage_limit_per_customer,
    usage_count: discount.usage_count,
    created_at: discount.created_at,
    updated_at: discount.updated_at,
  });
});

// DELETE /v1/discounts/:id (deactivate)
discountRoutes.delete('/:id', adminOnly, async (c) => {
  const id = c.req.param('id');
  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [discount] = await db.query<any>(
    `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
    [id, store.id]
  );
  if (!discount) throw ApiError.notFound('Discount not found');

  await db.run(
    `UPDATE discounts SET status = 'inactive', updated_at = ? WHERE id = ? AND store_id = ?`,
    [now(), id, store.id]
  );

  return c.json({ ok: true });
});

export { discountRoutes as discounts };

