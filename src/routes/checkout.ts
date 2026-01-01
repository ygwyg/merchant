import { Hono } from 'hono';
import Stripe from 'stripe';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ApiError, uuid, now, isValidEmail, type Env, type AuthContext } from '../types';
import { validateDiscount, calculateDiscount, type Discount } from './discounts';

// ============================================================
// CHECKOUT ROUTES
// ============================================================

export const checkout = new Hono<{
  Bindings: Env;
  Variables: { auth: AuthContext };
}>();

checkout.use('*', authMiddleware);

// GET /v1/carts/:cartId - Retrieve cart
checkout.get('/:cartId', async (c) => {
  const cartId = c.req.param('cartId');
  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [cart] = await db.query<any>(
    `SELECT * FROM carts WHERE id = ? AND store_id = ?`,
    [cartId, store.id]
  );
  if (!cart) throw ApiError.notFound('Cart not found');

  const items = await db.query<any>(`SELECT * FROM cart_items WHERE cart_id = ?`, [cartId]);

  return c.json({
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    customer_email: cart.customer_email,
    items: items.map((i) => ({
      sku: i.sku,
      title: i.title,
      qty: i.qty,
      unit_price_cents: i.unit_price_cents,
    })),
    expires_at: cart.expires_at,
    stripe_checkout_session_id: cart.stripe_checkout_session_id,
  });
});

// POST /v1/carts
checkout.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const customerEmail = body?.customer_email;

  if (!customerEmail || !isValidEmail(customerEmail)) {
    throw ApiError.invalidRequest('A valid customer_email is required');
  }

  const { store } = c.get('auth');
  const db = getDb(c.env);

  const id = uuid();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO carts (id, store_id, customer_email, expires_at) VALUES (?, ?, ?, ?)`,
    [id, store.id, customerEmail, expiresAt]
  );

  return c.json({
    id,
    status: 'open',
    currency: 'USD',
    customer_email: customerEmail,
    items: [],
    discount: null,
    totals: {
      subtotal_cents: 0,
      discount_cents: 0,
      shipping_cents: 0,
      tax_cents: 0,
      total_cents: 0,
    },
    expires_at: expiresAt,
  });
});

// POST /v1/carts/:cartId/items
checkout.post('/:cartId/items', async (c) => {
  const cartId = c.req.param('cartId');
  const body = await c.req.json().catch(() => ({}));
  const items = body?.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.invalidRequest('items array is required');
  }

  const { store } = c.get('auth');
  const db = getDb(c.env);

  // Get cart
  const [cart] = await db.query<any>(
    `SELECT * FROM carts WHERE id = ? AND store_id = ?`,
    [cartId, store.id]
  );
  if (!cart) throw ApiError.notFound('Cart not found');
  if (cart.status !== 'open') throw ApiError.conflict('Cart is not open');

  // Validate all items before modifying the cart
  const validatedItems = [];
  for (const { sku, qty } of items) {
    if (!sku || !qty || qty < 1) {
      throw ApiError.invalidRequest('Each item needs sku and qty > 0');
    }

    const [variant] = await db.query<any>(
      `SELECT * FROM variants WHERE store_id = ? AND sku = ?`,
      [store.id, sku]
    );
    if (!variant) throw ApiError.notFound(`SKU not found: ${sku}`);
    if (variant.status !== 'active') throw ApiError.invalidRequest(`SKU not active: ${sku}`);

    const [inv] = await db.query<any>(
      `SELECT * FROM inventory WHERE store_id = ? AND sku = ?`,
      [store.id, sku]
    );
    const available = (inv?.on_hand ?? 0) - (inv?.reserved ?? 0);
    if (available < qty) throw ApiError.insufficientInventory(sku);

    validatedItems.push({
      sku,
      title: variant.title,
      qty,
      unit_price_cents: variant.price_cents,
    });
  }

  // All items validated, now safe to clear and insert
  await db.run(`DELETE FROM cart_items WHERE cart_id = ?`, [cartId]);

  for (const item of validatedItems) {
    await db.run(
      `INSERT INTO cart_items (id, cart_id, sku, title, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), cartId, item.sku, item.title, item.qty, item.unit_price_cents]
    );
  }

  // Get all cart items from database to ensure accurate totals
  const allCartItems = await db.query<any>(`SELECT * FROM cart_items WHERE cart_id = ?`, [cartId]);
  const subtotalCents = allCartItems.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);

  // Recalculate discount if present
  let discountInfo = null;
  let discountAmountCents = 0;
  if (cart.discount_id) {
    const [discount] = await db.query<any>(
      `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
      [cart.discount_id, store.id]
    );
    if (discount) {
      try {
        await validateDiscount(db, discount as Discount, subtotalCents, cart.customer_email);
        discountAmountCents = calculateDiscount(discount as Discount, subtotalCents);
        await db.run(
          `UPDATE carts SET discount_amount_cents = ? WHERE id = ?`,
          [discountAmountCents, cartId]
        );
        discountInfo = {
          code: discount.code,
          type: discount.type,
          amount_cents: discountAmountCents,
        };
      } catch (err) {
        // Discount no longer valid, remove it
        await db.run(
          `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
          [cartId]
        );
      }
    } else {
      // Discount was deleted, clean up stale reference
      await db.run(
        `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
        [cartId]
      );
    }
  }

  return c.json({
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    customer_email: cart.customer_email,
    items: allCartItems.map(item => ({
      sku: item.sku,
      title: item.title,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
    })),
    discount: discountInfo,
    totals: {
      subtotal_cents: subtotalCents,
      discount_cents: discountAmountCents,
      shipping_cents: 0,
      tax_cents: 0,
      total_cents: subtotalCents - discountAmountCents,
    },
    expires_at: cart.expires_at,
  });
});

// POST /v1/carts/:cartId/checkout
checkout.post('/:cartId/checkout', async (c) => {
  const cartId = c.req.param('cartId');
  const body = await c.req.json().catch(() => ({}));
  const successUrl = body?.success_url;
  const cancelUrl = body?.cancel_url;
  const collectShipping = body?.collect_shipping ?? false;
  const shippingCountries = body?.shipping_countries ?? ['US'];
  const shippingOptions = body?.shipping_options;

  if (!successUrl) throw ApiError.invalidRequest('success_url is required');
  if (!cancelUrl) throw ApiError.invalidRequest('cancel_url is required');

  const { store } = c.get('auth');
  if (!store.stripe_secret_key) {
    throw ApiError.invalidRequest('Stripe not connected. POST /v1/setup/stripe first.');
  }

  const db = getDb(c.env);

  // Atomically update cart status from 'open' to 'checked_out' to prevent concurrent checkout race condition
  // This ensures only one checkout request can proceed for a given cart
  // We'll set stripe_checkout_session_id to NULL initially, then update it after creating the Stripe session
  const statusUpdateResult = await db.run(
    `UPDATE carts SET status = 'checked_out', updated_at = ? WHERE id = ? AND store_id = ? AND status = 'open'`,
    [now(), cartId, store.id]
  );
  
  if (statusUpdateResult.changes === 0) {
    // Cart not found, wrong store, or already checked out/expired
    const [cart] = await db.query<any>(
      `SELECT * FROM carts WHERE id = ? AND store_id = ?`,
      [cartId, store.id]
    );
    if (!cart) throw ApiError.notFound('Cart not found');
    if (cart.status !== 'open') throw ApiError.conflict('Cart is not open');
    // If we get here, cart exists and is open but update failed - this shouldn't happen
    throw ApiError.invalidRequest('Failed to initiate checkout. Please try again.');
  }

  // Fetch cart data after successful status update
  const [cart] = await db.query<any>(
    `SELECT * FROM carts WHERE id = ? AND store_id = ?`,
    [cartId, store.id]
  );
  if (!cart) throw ApiError.notFound('Cart not found');

  const items = await db.query<any>(`SELECT * FROM cart_items WHERE cart_id = ?`, [cartId]);
  if (items.length === 0) {
    // Cart is empty - revert status back to 'open' since checkout can't proceed
    await db.run(`UPDATE carts SET status = 'open', updated_at = ? WHERE id = ?`, [now(), cartId]);
    throw ApiError.invalidRequest('Cart is empty');
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);

  // Revert cart status to 'open' if checkout fails (to allow retry)
  const revertCartStatus = async () => {
    await db.run(`UPDATE carts SET status = 'open', updated_at = ? WHERE id = ?`, [now(), cartId]);
  };

  // Validate and recalculate discount if present
  let discountAmountCents = 0;
  let discount: Discount | null = null;
  let discountReserved = false;
  
  if (cart.discount_id) {
    const [discountRow] = await db.query<any>(
      `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
      [cart.discount_id, store.id]
    );
    if (discountRow) {
      discount = discountRow as Discount;
      
      // This ensures validation logic is centralized and doesn't diverge
      try {
        await validateDiscount(db, discount, subtotalCents, cart.customer_email);
      } catch (err) {
        // Discount no longer valid, remove from cart and revert status
        await db.run(
          `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
          [cartId]
        );
        await revertCartStatus();
        if (err instanceof ApiError) throw err;
        throw ApiError.invalidRequest('Discount is no longer valid');
      }
      
      // Now do atomic reservation (this handles usage_limit)
      const currentTime = now();
      
      // Note: There's a small race condition window between this check and the atomic reservation below.
      // Two concurrent checkouts for the same customer could both pass this check. However, the webhook
      // handler enforces the per-customer limit atomically using a conditional INSERT, preventing
      // concurrent checkouts from bypassing the limit. The race condition window is microseconds,
      // so it's unlikely but the webhook handler provides the final enforcement.
      if (discount.usage_limit_per_customer !== null) {
        const [usage] = await db.query<any>(
          `SELECT COUNT(*) as count FROM discount_usage WHERE discount_id = ? AND customer_email = ?`,
          [discount.id, cart.customer_email.toLowerCase()]
        );
        if (usage && usage.count >= discount.usage_limit_per_customer) {
          await db.run(
            `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
            [cartId]
          );
          await revertCartStatus();
          throw ApiError.invalidRequest('You have already used this discount');
        }
      }
      
      // Atomically increment usage_count only if within global limit
      // This prevents race conditions - if limit is reached, update affects 0 rows
      if (discount.usage_limit !== null) {
        const result = await db.run(
          `UPDATE discounts 
           SET usage_count = usage_count + 1, updated_at = ? 
           WHERE id = ? 
             AND status = 'active'
             AND (starts_at IS NULL OR starts_at <= ?)
             AND (expires_at IS NULL OR expires_at >= ?)
             AND usage_count < usage_limit`,
          [currentTime, discount.id, currentTime, currentTime]
        );
        
        if (result.changes === 0) {
          // Usage limit reached or discount became invalid - remove from cart and revert status
          await db.run(
            `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
            [cartId]
          );
          await revertCartStatus();
          throw ApiError.invalidRequest('Discount usage limit reached');
        }
        discountReserved = true;
      } else {
        // No usage limit, but still validate discount is active
        const result = await db.run(
          `UPDATE discounts 
           SET updated_at = ? 
           WHERE id = ? 
             AND status = 'active'
             AND (starts_at IS NULL OR starts_at <= ?)
             AND (expires_at IS NULL OR expires_at >= ?)`,
          [currentTime, discount.id, currentTime, currentTime]
        );
        
        if (result.changes === 0) {
          // Discount became invalid - remove from cart and revert status
          await db.run(
            `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
            [cartId]
          );
          await revertCartStatus();
          throw ApiError.invalidRequest('Discount is no longer valid');
        }
      }
      
      // Calculate discount amount
      discountAmountCents = calculateDiscount(discount, subtotalCents);
    } else {
      // Discount was deleted, clean up stale reference
      await db.run(
        `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
        [cartId]
      );
    }
  }

  // Release reserved discount usage if checkout fails
  const releaseReservedDiscount = async () => {
    if (discountReserved && discount) {
      await db.run(
        `UPDATE discounts SET usage_count = MAX(usage_count - 1, 0), updated_at = ? WHERE id = ?`,
        [now(), discount.id]
      );
    }
  };

  // Reserve inventory atomically - track which items were successfully reserved
  const reservedItems: { sku: string; qty: number }[] = [];
  
  const releaseReservedInventory = async () => {
    for (const item of reservedItems) {
      await db.run(
        `UPDATE inventory SET reserved = MAX(reserved - ?, 0), updated_at = ? WHERE store_id = ? AND sku = ?`,
        [item.qty, now(), store.id, item.sku]
      );
    }
    // Clear reservedItems after releasing to prevent double-release
    reservedItems.length = 0;
  };

  try {
    for (const item of items) {
      // Atomic check-and-reserve in single UPDATE with WHERE clause
      const result = await db.run(
        `UPDATE inventory SET reserved = reserved + ?, updated_at = ? 
         WHERE store_id = ? AND sku = ? AND on_hand - reserved >= ?`,
        [item.qty, now(), store.id, item.sku, item.qty]
      );
      
      if (result.changes === 0) {
        // Reservation failed - release any previously reserved items
        await releaseReservedInventory();
        throw ApiError.insufficientInventory(item.sku);
      }
      
      // Track successful reservation
      reservedItems.push({ sku: item.sku, qty: item.qty });
    }
  } catch (err) {
    if (err instanceof ApiError) {
      await releaseReservedDiscount();
      await releaseReservedInventory();
      await revertCartStatus();
      throw err;
    }
    await releaseReservedDiscount();
    await releaseReservedInventory();
    await revertCartStatus();
    throw err;
  }

  // Create Stripe session
  const stripe = new Stripe(store.stripe_secret_key);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item) => ({
    price_data: {
      currency: 'usd',
      product_data: { name: item.title },
      unit_amount: item.unit_price_cents,
    },
    quantity: item.qty,
  }));

  // Use Stripe coupon if discount is synced to Stripe
  // Merchant is source of truth for validation - Stripe just handles display
  // If discount isn't synced to Stripe, we still record it in the order for accounting
  // but customer will pay full price (discount won't be applied in Stripe)
  let stripeCouponId: string | null = null;
  if (discount && discountAmountCents > 0) {
    // For percentage discounts with a cap, we must create the coupon on-the-fly
    // because the capped amount depends on the order subtotal. Even if a coupon
    // exists from before this fix, it was created incorrectly with percent_off.
    const needsOnTheFlyCoupon = discount.type === 'percentage' && discount.max_discount_cents;
    
    if (discount.stripe_coupon_id && !needsOnTheFlyCoupon) {
      stripeCouponId = discount.stripe_coupon_id;
    } else if (store.stripe_secret_key) {
      // Discount not synced to Stripe - create coupon on the fly
      // This happens for percentage discounts with max_discount_cents cap,
      // or if discount wasn't synced when created/updated
      try {
        const stripe = new Stripe(store.stripe_secret_key);
        // For percentage discounts with a cap, we must use amount_off with the
        // calculated capped amount, not percent_off (which Stripe doesn't cap)
        const couponParams: Stripe.CouponCreateParams = {
          duration: 'once',
          metadata: { merchant_discount_id: discount.id },
        };
        
        if (discount.type === 'percentage' && discount.max_discount_cents) {
          // Use amount_off with the already-calculated capped discount amount
          // discountAmountCents was calculated using calculateDiscount which respects the cap
          couponParams.amount_off = discountAmountCents;
          couponParams.currency = 'usd';
        } else if (discount.type === 'percentage') {
          // Percentage discount without cap - use percent_off
          couponParams.percent_off = discount.value;
        } else {
          // Fixed amount discount
          couponParams.amount_off = discount.value;
          couponParams.currency = 'usd';
        }
        
        const coupon = await stripe.coupons.create(couponParams);
        stripeCouponId = coupon.id;
      } catch (err: any) {
        // Stripe coupon creation failed - release reserved discount usage and fail checkout
        // This prevents overcharging the customer and consuming discount slots without benefit
        await releaseReservedDiscount();
        await releaseReservedInventory();
        await revertCartStatus();
        console.error(`Failed to create Stripe coupon for discount: ${err.message}`);
        throw ApiError.invalidRequest('Failed to apply discount. Please try again or remove the discount and proceed.');
      }
    }
  }

  // Build shipping options if provided, otherwise use defaults
  const defaultShippingOptions: Stripe.Checkout.SessionCreateParams.ShippingOption[] = [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 0, currency: 'usd' },
        display_name: 'Standard Shipping',
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 5 },
          maximum: { unit: 'business_day', value: 7 },
        },
      },
    },
  ];

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: cart.customer_email,
      automatic_tax: { enabled: true },
      ...(collectShipping && {
        shipping_address_collection: {
          allowed_countries: shippingCountries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
        },
        shipping_options: shippingOptions ?? defaultShippingOptions,
      }),
      line_items: lineItems,
      ...(stripeCouponId && { discounts: [{ coupon: stripeCouponId }] }),
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        cart_id: cartId,
        store_id: store.id,
        ...(discount && {
          discount_id: discount.id,
          discount_code: discount.code || '',
          discount_type: discount.type,
        }),
      },
    });
  } catch (err: any) {
    // Release reserved discount and inventory if Stripe session creation fails
    await releaseReservedDiscount();
    await releaseReservedInventory();
    await revertCartStatus();
    throw ApiError.invalidRequest('Payment processing error. Please try again.');
  }

  // Update cart with Stripe session ID and final discount amount
  // Note: Cart status is already 'checked_out' from the atomic update at the start
  // Discount usage was already reserved above, will be committed when order is created via webhook
  // Set updated_at to track when checkout was initiated (for abandoned checkout detection)
  await db.run(
    `UPDATE carts SET stripe_checkout_session_id = ?, discount_amount_cents = ?, updated_at = ? WHERE id = ?`,
    [session.id, discountAmountCents, now(), cartId]
  );

  return c.json({
    checkout_url: session.url,
    stripe_checkout_session_id: session.id,
  });
});

// POST /v1/carts/:cartId/apply-discount
checkout.post('/:cartId/apply-discount', async (c) => {
  const cartId = c.req.param('cartId');
  const body = await c.req.json().catch(() => ({}));
  const code = body?.code;

  if (!code || typeof code !== 'string') {
    throw ApiError.invalidRequest('code is required');
  }

  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [cart] = await db.query<any>(
    `SELECT * FROM carts WHERE id = ? AND store_id = ?`,
    [cartId, store.id]
  );
  if (!cart) throw ApiError.notFound('Cart not found');
  if (cart.status !== 'open') throw ApiError.conflict('Cart is not open');

  // Normalize code to uppercase for lookup
  const normalizedCode = code.toUpperCase().trim();

  const [discount] = await db.query<any>(
    `SELECT * FROM discounts WHERE code = ? AND store_id = ?`,
    [normalizedCode, store.id]
  );
  if (!discount) throw ApiError.notFound('Discount code not found');

  // Get cart items to calculate subtotal
  const items = await db.query<any>(`SELECT * FROM cart_items WHERE cart_id = ?`, [cartId]);
  if (items.length === 0) throw ApiError.invalidRequest('Cart is empty');

  const subtotalCents = items.reduce((sum: number, item: any) => {
    return sum + item.unit_price_cents * item.qty;
  }, 0);

  // Validate discount (include customer email for per-customer limit check)
  await validateDiscount(db, discount as Discount, subtotalCents, cart.customer_email);

  // Calculate discount
  const discountAmountCents = calculateDiscount(discount as Discount, subtotalCents);

  // Update cart (use canonical discount.code from database, not user input)
  await db.run(
    `UPDATE carts SET discount_code = ?, discount_id = ?, discount_amount_cents = ? WHERE id = ?`,
    [discount.code, discount.id, discountAmountCents, cartId]
  );

  return c.json({
    discount: {
      code: discount.code,
      type: discount.type,
      amount_cents: discountAmountCents,
    },
    totals: {
      subtotal_cents: subtotalCents,
      discount_cents: discountAmountCents,
      shipping_cents: 0,
      tax_cents: 0,
      total_cents: subtotalCents - discountAmountCents,
    },
  });
});

// DELETE /v1/carts/:cartId/discount
checkout.delete('/:cartId/discount', async (c) => {
  const cartId = c.req.param('cartId');

  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [cart] = await db.query<any>(
    `SELECT * FROM carts WHERE id = ? AND store_id = ?`,
    [cartId, store.id]
  );
  if (!cart) throw ApiError.notFound('Cart not found');
  if (cart.status !== 'open') throw ApiError.conflict('Cart is not open');

  await db.run(
    `UPDATE carts SET discount_code = NULL, discount_id = NULL, discount_amount_cents = 0 WHERE id = ?`,
    [cartId]
  );

  // Return updated totals
  const items = await db.query<any>(`SELECT * FROM cart_items WHERE cart_id = ?`, [cartId]);
  const subtotalCents = items.reduce((sum: number, item: any) => {
    return sum + item.unit_price_cents * item.qty;
  }, 0);

  return c.json({
    discount: null,
    totals: {
      subtotal_cents: subtotalCents,
      discount_cents: 0,
      shipping_cents: 0,
      tax_cents: 0,
      total_cents: subtotalCents,
    },
  });
});
