/**
 * Analytics & Financial Intelligence Routes
 *
 * Enterprise-grade profitability analytics, inventory valuation,
 * cost management, and financial reporting for the merchant platform.
 * All monetary values are in minor currency units (cents) using
 * integer arithmetic to guarantee precision.
 *
 * @author Basem Hegazy <basem.hegazy@outlook.com>
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { getDb } from '../db';
import { ApiError, uuid } from '../types';
import type { HonoEnv } from '../types';
import {
  AnalyticsQuery,
  SetCostBody,
  AnalyticsDashboardResponse,
  ProductProfitabilityList,
  TrendResponse,
  InventoryValuationResponse,
} from '../schemas';

const router = new OpenAPIHono<HonoEnv>();
router.use('*', authMiddleware);

function toBps(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000);
}

// ── Dashboard Summary ────────────────────────────────────────────

const dashboardRoute = createRoute({
  method: 'get',
  path: '/v1/analytics/dashboard',
  middleware: [adminOnly] as const,
  responses: {
    200: {
      content: { 'application/json': { schema: AnalyticsDashboardResponse } },
      description: 'Analytics dashboard with summary and top/bottom products',
    },
  },
  tags: ['analytics'],
  summary: 'Dashboard Summary',
  description: 'Returns revenue, cost, profit summary cards and top/bottom 5 products.',
});

router.openapi(dashboardRoute, async (c) => {
  const db = getDb(c.var.db);

  const [summary] = await db.query<Record<string, unknown>>(
    `SELECT
      COALESCE(SUM(o.total_cents), 0) as total_revenue_cents,
      COALESCE(SUM(o.discount_amount_cents), 0) as total_discounts_cents,
      COUNT(*) as total_orders
    FROM orders o
    WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')`,
    []
  );

  const [refundSum] = await db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(r.amount_cents), 0) as total_refunds_cents
    FROM refunds r
    JOIN orders o ON r.order_id = o.id
    WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')`,
    []
  );

  const [costSum] = await db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(
      COALESCE((SELECT c2.cost_cents FROM costs c2
        JOIN variants v2 ON (c2.variant_id = v2.id OR (c2.variant_id IS NULL AND c2.product_id = v2.product_id))
        WHERE v2.sku = oi.sku
        ORDER BY c2.variant_id NOT NULL DESC LIMIT 1), 0) * oi.qty
    ), 0) as total_cost_cents
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')`,
    []
  );

  const [invSum] = await db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(
      i.on_hand * COALESCE(
        (SELECT c.cost_cents FROM costs c
          JOIN variants v ON (c.variant_id = v.id OR (c.variant_id IS NULL AND c.product_id = v.product_id))
          WHERE v.sku = i.sku
          ORDER BY c.variant_id NOT NULL DESC LIMIT 1), 0)
    ), 0) as inventory_value_cents,
    COALESCE(SUM(i.on_hand), 0) as total_on_hand
    FROM inventory i`,
    []
  );

  const revenue = (summary?.total_revenue_cents as number) || 0;
  const discounts = (summary?.total_discounts_cents as number) || 0;
  const refunds = (refundSum?.total_refunds_cents as number) || 0;
  const cost = (costSum?.total_cost_cents as number) || 0;
  const orders = (summary?.total_orders as number) || 0;
  const netRevenue = revenue - discounts - refunds;
  const grossProfit = revenue - cost;
  const inventoryValue = (invSum?.inventory_value_cents as number) || 0;

  const topProducts = await db.query<Record<string, unknown>>(
    `SELECT
      p.id as product_id, p.title as product_title, p.status as product_status,
      COUNT(DISTINCT v.id) as variants_count,
      COALESCE(SUM(oi.qty), 0) as units_sold,
      COALESCE(SUM(oi.unit_price_cents * oi.qty), 0) as revenue_cents,
      COALESCE(SUM(
        COALESCE((SELECT c2.cost_cents FROM costs c2
          JOIN variants v2 ON (c2.variant_id = v2.id OR (c2.variant_id IS NULL AND c2.product_id = v2.product_id))
          WHERE v2.sku = oi.sku
          ORDER BY c2.variant_id NOT NULL DESC LIMIT 1), 0) * oi.qty
      ), 0) as cost_cents
    FROM products p
    JOIN variants v ON v.product_id = p.id
    LEFT JOIN order_items oi ON oi.sku = v.sku
    LEFT JOIN orders o ON oi.order_id = o.id AND o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')
    GROUP BY p.id
    HAVING units_sold > 0
    ORDER BY (revenue_cents - cost_cents) DESC
    LIMIT 5`,
    []
  );

  const bottomProducts = await db.query<Record<string, unknown>>(
    `SELECT
      p.id as product_id, p.title as product_title, p.status as product_status,
      COUNT(DISTINCT v.id) as variants_count,
      COALESCE(SUM(oi.qty), 0) as units_sold,
      COALESCE(SUM(oi.unit_price_cents * oi.qty), 0) as revenue_cents,
      COALESCE(SUM(
        COALESCE((SELECT c2.cost_cents FROM costs c2
          JOIN variants v2 ON (c2.variant_id = v2.id OR (c2.variant_id IS NULL AND c2.product_id = v2.product_id))
          WHERE v2.sku = oi.sku
          ORDER BY c2.variant_id NOT NULL DESC LIMIT 1), 0) * oi.qty
      ), 0) as cost_cents
    FROM products p
    JOIN variants v ON v.product_id = p.id
    LEFT JOIN order_items oi ON oi.sku = v.sku
    LEFT JOIN orders o ON oi.order_id = o.id AND o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')
    GROUP BY p.id
    HAVING units_sold > 0
    ORDER BY (revenue_cents - cost_cents) ASC
    LIMIT 5`,
    []
  );

  const mapProduct = (row: Record<string, unknown>) => {
    const rev = row.revenue_cents as number;
    const cst = row.cost_cents as number;
    const profit = rev - cst;
    return {
      product_id: row.product_id as string,
      product_title: row.product_title as string,
      product_status: row.product_status as string,
      variants_count: row.variants_count as number,
      units_sold: row.units_sold as number,
      revenue_cents: rev,
      cost_cents: cst,
      gross_profit_cents: profit,
      gross_margin_bps: toBps(profit, rev),
      refund_cents: 0,
      discount_cents: 0,
      net_revenue_cents: rev,
    };
  };

  return c.json({
    summary: {
      total_revenue_cents: revenue,
      total_cost_cents: cost,
      gross_profit_cents: grossProfit,
      gross_margin_bps: toBps(grossProfit, netRevenue),
      total_orders: orders,
      total_refunds_cents: refunds,
      total_discounts_cents: discounts,
      inventory_value_cents: inventoryValue,
      unsold_inventory_cents: inventoryValue,
    },
    top_products: topProducts.map(mapProduct),
    bottom_products: bottomProducts.map(mapProduct),
  });
});

// ── Product Profitability List ───────────────────────────────────

const productsRoute = createRoute({
  method: 'get',
  path: '/v1/analytics/products',
  middleware: [adminOnly] as const,
  request: { query: AnalyticsQuery },
  responses: {
    200: {
      content: { 'application/json': { schema: ProductProfitabilityList } },
      description: 'Product profitability list',
    },
  },
  tags: ['analytics'],
  summary: 'Product Profitability',
  description: 'Returns per-product profitability with sorting by profit, revenue, margin, or units sold.',
});

router.openapi(productsRoute, async (c) => {
  const db = getDb(c.var.db);
  const query = c.req.valid('query');
  const sort = query.sort || 'profit';
  const order = query.order || 'desc';

  const validSorts: Record<string, string> = {
    profit: '(revenue_cents - cost_cents)',
    revenue: 'revenue_cents',
    margin: 'CASE WHEN revenue_cents > 0 THEN (revenue_cents - cost_cents) * 10000 / revenue_cents ELSE 0 END',
    units: 'units_sold',
  };
  const orderBy = validSorts[sort] || validSorts.profit;
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
      p.id as product_id, p.title as product_title, p.status as product_status,
      COUNT(DISTINCT v.id) as variants_count,
      COALESCE(SUM(oi.qty), 0) as units_sold,
      COALESCE(SUM(oi.unit_price_cents * oi.qty), 0) as revenue_cents,
      COALESCE(SUM(
        COALESCE((SELECT c2.cost_cents FROM costs c2
          JOIN variants v2 ON (c2.variant_id = v2.id OR (c2.variant_id IS NULL AND c2.product_id = v2.product_id))
          WHERE v2.sku = oi.sku
          ORDER BY c2.variant_id NOT NULL DESC LIMIT 1), 0) * oi.qty
      ), 0) as cost_cents
    FROM products p
    JOIN variants v ON v.product_id = p.id
    LEFT JOIN order_items oi ON oi.sku = v.sku
    LEFT JOIN orders o ON oi.order_id = o.id AND o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')
    GROUP BY p.id
    ORDER BY ${orderBy} ${dir}`,
    []
  );

  const items = rows.map((row) => {
    const rev = row.revenue_cents as number;
    const cst = row.cost_cents as number;
    const profit = rev - cst;
    return {
      product_id: row.product_id as string,
      product_title: row.product_title as string,
      product_status: row.product_status as string,
      variants_count: row.variants_count as number,
      units_sold: row.units_sold as number,
      revenue_cents: rev,
      cost_cents: cst,
      gross_profit_cents: profit,
      gross_margin_bps: toBps(profit, rev),
      refund_cents: 0,
      discount_cents: 0,
      net_revenue_cents: rev,
    };
  });

  const totals = items.reduce(
    (acc, item) => ({
      total_revenue_cents: acc.total_revenue_cents + item.revenue_cents,
      total_cost_cents: acc.total_cost_cents + item.cost_cents,
      total_profit_cents: acc.total_profit_cents + item.gross_profit_cents,
      total_units_sold: acc.total_units_sold + item.units_sold,
    }),
    { total_revenue_cents: 0, total_cost_cents: 0, total_profit_cents: 0, total_units_sold: 0 }
  );

  return c.json({ items, totals });
});

// ── Trend Data ───────────────────────────────────────────────────

const trendsRoute = createRoute({
  method: 'get',
  path: '/v1/analytics/trends',
  middleware: [adminOnly] as const,
  request: { query: AnalyticsQuery },
  responses: {
    200: {
      content: { 'application/json': { schema: TrendResponse } },
      description: 'Profitability trend data',
    },
  },
  tags: ['analytics'],
  summary: 'Profitability Trends',
  description: 'Daily revenue, cost, profit and margin data for chart rendering.',
});

router.openapi(trendsRoute, async (c) => {
  const db = getDb(c.var.db);
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 365);

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
      DATE(o.created_at) as date,
      COALESCE(SUM(o.total_cents), 0) as revenue_cents,
      COALESCE(SUM(o.discount_amount_cents), 0) as discount_cents,
      COALESCE((SELECT SUM(r.amount_cents) FROM refunds r WHERE r.order_id = o.id), 0) as refund_cents,
      COUNT(*) as orders_count
    FROM orders o
    WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')
      AND o.created_at >= DATE('now', ?)
    GROUP BY DATE(o.created_at)
    ORDER BY date ASC`,
    [`-${days} days`]
  );

  const items = [];
  for (const row of rows) {
    const revenue = row.revenue_cents as number;
    const refunds = row.refund_cents as number;
    const discounts = row.discount_cents as number;
    const netRevenue = revenue - discounts - refunds;

    const [costRow] = await db.query<Record<string, unknown>>(
      `SELECT COALESCE(SUM(
        COALESCE((SELECT c2.cost_cents FROM costs c2
          JOIN variants v2 ON (c2.variant_id = v2.id OR (c2.variant_id IS NULL AND c2.product_id = v2.product_id))
          WHERE v2.sku = oi.sku
          ORDER BY c2.variant_id NOT NULL DESC LIMIT 1), 0) * oi.qty
      ), 0) as cost_cents
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered', 'refunded')
        AND DATE(o.created_at) = ?`,
      [row.date as string]
    );
    const cost = (costRow?.cost_cents as number) || 0;
    const profit = revenue - cost;

    items.push({
      date: row.date as string,
      revenue_cents: revenue,
      cost_cents: cost,
      profit_cents: profit,
      margin_bps: toBps(profit, netRevenue),
      orders_count: row.orders_count as number,
    });
  }

  return c.json({ items });
});

// ── Inventory Valuation ──────────────────────────────────────────

const valuationRoute = createRoute({
  method: 'get',
  path: '/v1/analytics/inventory-valuation',
  middleware: [adminOnly] as const,
  responses: {
    200: {
      content: { 'application/json': { schema: InventoryValuationResponse } },
      description: 'Inventory valuation',
    },
  },
  tags: ['analytics'],
  summary: 'Inventory Valuation',
  description: 'Current inventory value per SKU, with unit cost and potential revenue.',
});

router.openapi(valuationRoute, async (c) => {
  const db = getDb(c.var.db);

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
      i.sku, v.title as variant_title, p.title as product_title,
      i.on_hand,
      COALESCE(
        (SELECT c.cost_cents FROM costs c
          JOIN variants v2 ON (c.variant_id = v2.id OR (c.variant_id IS NULL AND c.product_id = v2.product_id))
          WHERE v2.sku = i.sku
          ORDER BY c.variant_id NOT NULL DESC LIMIT 1), 0
      ) as cost_cents,
      v.price_cents
    FROM inventory i
    JOIN variants v ON v.sku = i.sku
    JOIN products p ON p.id = v.product_id
    WHERE i.on_hand > 0
    ORDER BY (i.on_hand * COALESCE(
      (SELECT c.cost_cents FROM costs c
        JOIN variants v2 ON (c.variant_id = v2.id OR (c.variant_id IS NULL AND c.product_id = v2.product_id))
        WHERE v2.sku = i.sku
        ORDER BY c.variant_id NOT NULL DESC LIMIT 1), 0
    )) DESC`,
    []
  );

  const items = rows.map((row) => {
    const cost = row.cost_cents as number;
    const onHand = row.on_hand as number;
    return {
      sku: row.sku as string,
      variant_title: row.variant_title as string | null,
      product_title: row.product_title as string | null,
      on_hand: onHand,
      cost_cents: cost,
      total_value_cents: onHand * cost,
      potential_revenue_cents: onHand * (row.price_cents as number),
    };
  });

  const totals = items.reduce(
    (acc, item) => ({
      total_value_cents: acc.total_value_cents + item.total_value_cents,
      total_potential_revenue_cents: acc.total_potential_revenue_cents + item.potential_revenue_cents,
      total_on_hand: acc.total_on_hand + item.on_hand,
    }),
    { total_value_cents: 0, total_potential_revenue_cents: 0, total_on_hand: 0 }
  );

  return c.json({ items, totals });
});

// ── Set Product Cost ─────────────────────────────────────────────

const setProductCostRoute = createRoute({
  method: 'patch',
  path: '/v1/products/{id}/cost',
  middleware: [adminOnly] as const,
  request: {
    body: { content: { 'application/json': { schema: SetCostBody } } },
  },
  responses: {
    200: { description: 'Cost updated' },
  },
  tags: ['analytics'],
  summary: 'Set Product Cost',
  description: 'Set the default cost for a product (applies to variants without their own cost).',
});

router.openapi(setProductCostRoute, async (c) => {
  const db = getDb(c.var.db);
  const productId = c.req.param('id');
  const body = c.req.valid('json');

  const [product] = await db.query<Record<string, unknown>>(`SELECT id FROM products WHERE id = ?`, [productId]);
  if (!product) throw ApiError.notFound('Product not found');

  const [existing] = await db.query<Record<string, unknown>>(
    `SELECT id FROM costs WHERE product_id = ? AND variant_id IS NULL`,
    [productId]
  );

  if (existing) {
    await db.run(`UPDATE costs SET cost_cents = ?, updated_at = datetime('now') WHERE id = ?`, [
      body.cost_cents,
      existing.id as string,
    ]);
  } else {
    await db.run(
      `INSERT INTO costs (id, product_id, variant_id, cost_cents, currency, updated_at) VALUES (?, ?, NULL, ?, 'USD', datetime('now'))`,
      [uuid(), productId, body.cost_cents]
    );
  }

  return c.json({ ok: true });
});

// ── Set Variant Cost ─────────────────────────────────────────────

const setVariantCostRoute = createRoute({
  method: 'patch',
  path: '/v1/products/{id}/variants/{variantId}/cost',
  middleware: [adminOnly] as const,
  request: {
    body: { content: { 'application/json': { schema: SetCostBody } } },
  },
  responses: {
    200: { description: 'Cost updated' },
  },
  tags: ['analytics'],
  summary: 'Set Variant Cost',
  description: 'Set cost for a specific variant, overriding the product default.',
});

router.openapi(setVariantCostRoute, async (c) => {
  const db = getDb(c.var.db);
  const productId = c.req.param('id');
  const variantId = c.req.param('variantId');
  const body = c.req.valid('json');

  const [variant] = await db.query<Record<string, unknown>>(
    `SELECT id FROM variants WHERE id = ? AND product_id = ?`,
    [variantId, productId]
  );
  if (!variant) throw ApiError.notFound('Variant not found');

  const [existing] = await db.query<Record<string, unknown>>(
    `SELECT id FROM costs WHERE variant_id = ?`,
    [variantId]
  );

  if (existing) {
    await db.run(`UPDATE costs SET cost_cents = ?, updated_at = datetime('now') WHERE id = ?`, [
      body.cost_cents,
      existing.id as string,
    ]);
  } else {
    await db.run(
      `INSERT INTO costs (id, product_id, variant_id, cost_cents, currency, updated_at) VALUES (?, ?, ?, ?, 'USD', datetime('now'))`,
      [uuid(), productId, variantId, body.cost_cents]
    );
  }

  return c.json({ ok: true });
});

// ── Get Costs for a Product ──────────────────────────────────────

const getCostsRoute = createRoute({
  method: 'get',
  path: '/v1/products/{id}/costs',
  middleware: [adminOnly] as const,
  responses: {
    200: { description: 'Product costs' },
  },
  tags: ['analytics'],
  summary: 'Get Product Costs',
  description: 'Returns the product-level default cost and per-variant costs.',
});

router.openapi(getCostsRoute, async (c) => {
  const db = getDb(c.var.db);
  const productId = c.req.param('id');

  const [product] = await db.query<Record<string, unknown>>(`SELECT id FROM products WHERE id = ?`, [productId]);
  if (!product) throw ApiError.notFound('Product not found');

  const productCost = await db.query<Record<string, unknown>>(
    `SELECT cost_cents, currency, updated_at FROM costs WHERE product_id = ? AND variant_id IS NULL`,
    [productId]
  );

  const variantCosts = await db.query<Record<string, unknown>>(
    `SELECT c.cost_cents, c.currency, c.updated_at, v.id as variant_id, v.sku, v.title as variant_title
     FROM costs c
     JOIN variants v ON v.id = c.variant_id
     WHERE c.product_id = ? AND c.variant_id IS NOT NULL`,
    [productId]
  );

  return c.json({
    product_cost: productCost.length > 0
      ? {
          cost_cents: productCost[0].cost_cents as number,
          currency: productCost[0].currency as string,
          updated_at: productCost[0].updated_at as string,
        }
      : null,
    variant_costs: variantCosts.map((r) => ({
      variant_id: r.variant_id as string,
      sku: r.sku as string,
      variant_title: r.variant_title as string,
      cost_cents: r.cost_cents as number,
      currency: r.currency as string,
      updated_at: r.updated_at as string,
    })),
  });
});

export { router as analytics };
