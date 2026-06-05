/**
 * Category management API routes.
 *
 * Provides CRUD operations for product categories including
 * hierarchical parent/child relationships and product assignment.
 *
 * @author Basem Hegazy <basem.hegazy@outlook.com>
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { getDb } from '../db';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { ApiError, uuid, now, slugify, type HonoEnv } from '../types';
import {
  IdParam,
  CategoryResponse,
  CategoryDetailResponse,
  CategoryListResponse,
  CreateCategoryBody,
  UpdateCategoryBody,
  CategoryQuery,
  CategoryIdParam,
  ManageCategoryProductsBody,
  ErrorResponse,
  DeletedResponse,
  OkResponse,
} from '../schemas';

const app = new OpenAPIHono<HonoEnv>();

app.use('*', authMiddleware);

const listCategories = createRoute({
  method: 'get',
  path: '/',
  tags: ['Categories'],
  summary: 'List categories',
  security: [{ bearerAuth: [] }],
  request: { query: CategoryQuery },
  responses: {
    200: { content: { 'application/json': { schema: CategoryListResponse } }, description: 'List of categories' },
  },
});

app.openapi(listCategories, async (c) => {
  const db = getDb(c.var.db);
  const { limit: limitStr, cursor, status } = c.req.valid('query');
  const limit = Math.min(parseInt(limitStr || '20'), 100);

  let query = `SELECT c.*, (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) as product_count FROM categories c`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (status) {
    conditions.push(`c.status = ?`);
    params.push(status);
  }
  if (cursor) {
    conditions.push(`c.created_at < ?`);
    params.push(cursor);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY c.sort_order ASC, c.created_at DESC LIMIT ?`;
  params.push(limit + 1);

  const categories = await db.query<any>(query, params);
  const hasMore = categories.length > limit;
  if (hasMore) categories.pop();

  const items = categories.map((cat: any) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    description: cat.description,
    image_url: cat.image_url,
    parent_id: cat.parent_id,
    status: cat.status,
    sort_order: cat.sort_order,
    product_count: cat.product_count,
    created_at: cat.created_at,
    updated_at: cat.updated_at,
  }));

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;

  return c.json({ items, pagination: { has_more: hasMore, next_cursor: nextCursor } }, 200);
});

const getCategory = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Categories'],
  summary: 'Get category by ID',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: CategoryDetailResponse } }, description: 'Category details' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(getCategory, async (c) => {
  const db = getDb(c.var.db);
  const { id } = c.req.valid('param');

  const [category] = await db.query<any>(
    `SELECT c.*, (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) as product_count FROM categories c WHERE c.id = ?`,
    [id]
  );
  if (!category) throw ApiError.notFound('Category not found');

  const products = await db.query<any>(
    `SELECT p.id, p.title, p.status, p.image_url FROM products p
     JOIN product_categories pc ON pc.product_id = p.id
     WHERE pc.category_id = ?
     ORDER BY p.title ASC`,
    [id]
  );

  return c.json({
    ...category,
    products,
  }, 200);
});

const createCategory = createRoute({
  method: 'post',
  path: '/',
  tags: ['Categories'],
  summary: 'Create category',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: { body: { content: { 'application/json': { schema: CreateCategoryBody } } } },
  responses: {
    201: { content: { 'application/json': { schema: CategoryResponse } }, description: 'Category created' },
    400: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Invalid request' },
  },
});

app.openapi(createCategory, async (c) => {
  const { name, description, image_url, parent_id, status, sort_order } = c.req.valid('json');
  const db = getDb(c.var.db);
  const id = uuid();
  const timestamp = now();
  const slug = slugify(name);

  const [existingSlug] = await db.query<any>(`SELECT id FROM categories WHERE slug = ?`, [slug]);
  if (existingSlug) throw ApiError.invalidRequest(`Slug "${slug}" already exists`);

  await db.run(
    `INSERT INTO categories (id, name, slug, description, image_url, parent_id, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, slug, description || null, image_url || null, parent_id || null, status || 'active', sort_order ?? 0, timestamp, timestamp]
  );

  return c.json({
    id, name, slug, description: description || null, image_url: image_url || null,
    parent_id: parent_id || null, status: status || 'active', sort_order: sort_order ?? 0,
    product_count: 0, created_at: timestamp, updated_at: timestamp,
  }, 201);
});

const updateCategory = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Categories'],
  summary: 'Update category',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateCategoryBody } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: CategoryResponse } }, description: 'Category updated' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(updateCategory, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const db = getDb(c.var.db);

  const [existing] = await db.query<any>(`SELECT * FROM categories WHERE id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Category not found');

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined) {
    const slug = slugify(body.name);
    const [existingSlug] = await db.query<any>(`SELECT id FROM categories WHERE slug = ? AND id != ?`, [slug, id]);
    if (existingSlug) throw ApiError.invalidRequest(`Slug "${slug}" already exists`);
    updates.push('name = ?, slug = ?');
    params.push(body.name, slug);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    params.push(body.description);
  }
  if (body.image_url !== undefined) {
    updates.push('image_url = ?');
    params.push(body.image_url);
  }
  if (body.parent_id !== undefined) {
    updates.push('parent_id = ?');
    params.push(body.parent_id);
  }
  if (body.status !== undefined) {
    updates.push('status = ?');
    params.push(body.status);
  }
  if (body.sort_order !== undefined) {
    updates.push('sort_order = ?');
    params.push(body.sort_order);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(now());
    params.push(id);
    await db.run(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  const [category] = await db.query<any>(
    `SELECT c.*, (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) as product_count FROM categories c WHERE c.id = ?`,
    [id]
  );

  return c.json({
    id: category.id, name: category.name, slug: category.slug,
    description: category.description, image_url: category.image_url,
    parent_id: category.parent_id, status: category.status,
    sort_order: category.sort_order, product_count: category.product_count,
    created_at: category.created_at, updated_at: category.updated_at,
  }, 200);
});

const deleteCategory = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Categories'],
  summary: 'Delete category',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: DeletedResponse } }, description: 'Category deleted' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
    409: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Has subcategories' },
  },
});

app.openapi(deleteCategory, async (c) => {
  const { id } = c.req.valid('param');
  const db = getDb(c.var.db);

  const [category] = await db.query<any>(`SELECT * FROM categories WHERE id = ?`, [id]);
  if (!category) throw ApiError.notFound('Category not found');

  const [subcategory] = await db.query<any>(`SELECT id FROM categories WHERE parent_id = ? LIMIT 1`, [id]);
  if (subcategory) {
    throw ApiError.conflict('Cannot delete category with subcategories. Remove or reassign subcategories first.');
  }

  await db.run(`DELETE FROM product_categories WHERE category_id = ?`, [id]);
  await db.run(`DELETE FROM categories WHERE id = ?`, [id]);

  return c.json({ deleted: true as const }, 200);
});

const addCategoryProducts = createRoute({
  method: 'post',
  path: '/{id}/products',
  tags: ['Categories'],
  summary: 'Add products to category',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ManageCategoryProductsBody } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkResponse } }, description: 'Products added' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(addCategoryProducts, async (c) => {
  const { id } = c.req.valid('param');
  const { product_ids } = c.req.valid('json');
  const db = getDb(c.var.db);

  const [category] = await db.query<any>(`SELECT id FROM categories WHERE id = ?`, [id]);
  if (!category) throw ApiError.notFound('Category not found');

  for (const productId of product_ids) {
    await db.run(
      `INSERT OR IGNORE INTO product_categories (category_id, product_id) VALUES (?, ?)`,
      [id, productId]
    );
  }

  return c.json({ ok: true as const }, 200);
});

const removeCategoryProduct = createRoute({
  method: 'delete',
  path: '/{id}/products/{productId}',
  tags: ['Categories'],
  summary: 'Remove product from category',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: { params: z.object({
    id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }),
    productId: z.string().uuid().openapi({ param: { name: 'productId', in: 'path' } }),
  }) },
  responses: {
    200: { content: { 'application/json': { schema: OkResponse } }, description: 'Product removed' },
  },
});

app.openapi(removeCategoryProduct, async (c) => {
  const { id, productId } = c.req.valid('param');
  const db = getDb(c.var.db);

  await db.run(`DELETE FROM product_categories WHERE category_id = ? AND product_id = ?`, [id, productId]);

  return c.json({ ok: true as const }, 200);
});

export { app as categories };
