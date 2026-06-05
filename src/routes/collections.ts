/**
 * Collection management API routes.
 *
 * Provides CRUD operations for curated product collections
 * with manual product ordering support.
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
  CollectionResponse,
  CollectionDetailResponse,
  CollectionListResponse,
  CreateCollectionBody,
  UpdateCollectionBody,
  CollectionQuery,
  CollectionIdParam,
  ManageCollectionProductsBody,
  ReorderCollectionProductsBody,
  ErrorResponse,
  DeletedResponse,
  OkResponse,
} from '../schemas';

const app = new OpenAPIHono<HonoEnv>();

app.use('*', authMiddleware);

const ProductIdParam = z.object({
  collectionId: z.string().uuid().openapi({ param: { name: 'collectionId', in: 'path' } }),
  productId: z.string().uuid().openapi({ param: { name: 'productId', in: 'path' } }),
});

const listCollections = createRoute({
  method: 'get',
  path: '/',
  tags: ['Collections'],
  summary: 'List collections',
  security: [{ bearerAuth: [] }],
  request: { query: CollectionQuery },
  responses: {
    200: { content: { 'application/json': { schema: CollectionListResponse } }, description: 'List of collections' },
  },
});

app.openapi(listCollections, async (c) => {
  const db = getDb(c.var.db);
  const { limit: limitStr, cursor, status } = c.req.valid('query');
  const limit = Math.min(parseInt(limitStr || '20'), 100);

  let query = `SELECT col.*, (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = col.id) as product_count FROM collections col`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (status) {
    conditions.push(`col.status = ?`);
    params.push(status);
  }
  if (cursor) {
    conditions.push(`col.created_at < ?`);
    params.push(cursor);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY col.sort_order ASC, col.created_at DESC LIMIT ?`;
  params.push(limit + 1);

  const collections = await db.query<any>(query, params);
  const hasMore = collections.length > limit;
  if (hasMore) collections.pop();

  const items = collections.map((col: any) => ({
    id: col.id,
    name: col.name,
    slug: col.slug,
    description: col.description,
    image_url: col.image_url,
    status: col.status,
    sort_order: col.sort_order,
    product_count: col.product_count,
    created_at: col.created_at,
    updated_at: col.updated_at,
  }));

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null;

  return c.json({ items, pagination: { has_more: hasMore, next_cursor: nextCursor } }, 200);
});

const getCollection = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Collections'],
  summary: 'Get collection by ID',
  security: [{ bearerAuth: [] }],
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: CollectionDetailResponse } }, description: 'Collection details' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(getCollection, async (c) => {
  const db = getDb(c.var.db);
  const { id } = c.req.valid('param');

  const [collection] = await db.query<any>(
    `SELECT col.*, (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = col.id) as product_count FROM collections col WHERE col.id = ?`,
    [id]
  );
  if (!collection) throw ApiError.notFound('Collection not found');

  const products = await db.query<any>(
    `SELECT p.id, p.title, p.status, p.image_url, cp.sort_order
     FROM products p
     JOIN collection_products cp ON cp.product_id = p.id
     WHERE cp.collection_id = ?
     ORDER BY cp.sort_order ASC, p.title ASC`,
    [id]
  );

  return c.json({
    ...collection,
    products,
  }, 200);
});

const createCollection = createRoute({
  method: 'post',
  path: '/',
  tags: ['Collections'],
  summary: 'Create collection',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: { body: { content: { 'application/json': { schema: CreateCollectionBody } } } },
  responses: {
    201: { content: { 'application/json': { schema: CollectionResponse } }, description: 'Collection created' },
    400: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Invalid request' },
  },
});

app.openapi(createCollection, async (c) => {
  const { name, description, image_url, status, sort_order } = c.req.valid('json');
  const db = getDb(c.var.db);
  const id = uuid();
  const timestamp = now();
  const slug = slugify(name);

  const [existingSlug] = await db.query<any>(`SELECT id FROM collections WHERE slug = ?`, [slug]);
  if (existingSlug) throw ApiError.invalidRequest(`Slug "${slug}" already exists`);

  await db.run(
    `INSERT INTO collections (id, name, slug, description, image_url, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, slug, description || null, image_url || null, status || 'active', sort_order ?? 0, timestamp, timestamp]
  );

  return c.json({
    id, name, slug, description: description || null, image_url: image_url || null,
    status: status || 'active', sort_order: sort_order ?? 0,
    product_count: 0, created_at: timestamp, updated_at: timestamp,
  }, 201);
});

const updateCollection = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Collections'],
  summary: 'Update collection',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateCollectionBody } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: CollectionResponse } }, description: 'Collection updated' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(updateCollection, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const db = getDb(c.var.db);

  const [existing] = await db.query<any>(`SELECT * FROM collections WHERE id = ?`, [id]);
  if (!existing) throw ApiError.notFound('Collection not found');

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined) {
    const slug = slugify(body.name);
    const [existingSlug] = await db.query<any>(`SELECT id FROM collections WHERE slug = ? AND id != ?`, [slug, id]);
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
    await db.run(`UPDATE collections SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  const [collection] = await db.query<any>(
    `SELECT col.*, (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = col.id) as product_count FROM collections col WHERE col.id = ?`,
    [id]
  );

  return c.json({
    id: collection.id, name: collection.name, slug: collection.slug,
    description: collection.description, image_url: collection.image_url,
    status: collection.status, sort_order: collection.sort_order,
    product_count: collection.product_count,
    created_at: collection.created_at, updated_at: collection.updated_at,
  }, 200);
});

const deleteCollection = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Collections'],
  summary: 'Delete collection',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: { params: IdParam },
  responses: {
    200: { content: { 'application/json': { schema: DeletedResponse } }, description: 'Collection deleted' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(deleteCollection, async (c) => {
  const { id } = c.req.valid('param');
  const db = getDb(c.var.db);

  const [collection] = await db.query<any>(`SELECT * FROM collections WHERE id = ?`, [id]);
  if (!collection) throw ApiError.notFound('Collection not found');

  await db.run(`DELETE FROM collection_products WHERE collection_id = ?`, [id]);
  await db.run(`DELETE FROM collections WHERE id = ?`, [id]);

  return c.json({ deleted: true as const }, 200);
});

const addCollectionProducts = createRoute({
  method: 'post',
  path: '/{id}/products',
  tags: ['Collections'],
  summary: 'Add products to collection',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ManageCollectionProductsBody } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkResponse } }, description: 'Products added' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(addCollectionProducts, async (c) => {
  const { id } = c.req.valid('param');
  const { product_ids } = c.req.valid('json');
  const db = getDb(c.var.db);

  const [collection] = await db.query<any>(`SELECT id FROM collections WHERE id = ?`, [id]);
  if (!collection) throw ApiError.notFound('Collection not found');

  const [maxSort] = await db.query<any>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort FROM collection_products WHERE collection_id = ?`,
    [id]
  );
  let nextSort = maxSort.next_sort;

  for (const productId of product_ids) {
    await db.run(
      `INSERT OR IGNORE INTO collection_products (collection_id, product_id, sort_order) VALUES (?, ?, ?)`,
      [id, productId, nextSort]
    );
    nextSort++;
  }

  return c.json({ ok: true as const }, 200);
});

const removeCollectionProduct = createRoute({
  method: 'delete',
  path: '/{id}/products/{productId}',
  tags: ['Collections'],
  summary: 'Remove product from collection',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: { params: ProductIdParam },
  responses: {
    200: { content: { 'application/json': { schema: OkResponse } }, description: 'Product removed' },
  },
});

app.openapi(removeCollectionProduct, async (c) => {
  const { collectionId, productId } = c.req.valid('param');
  const db = getDb(c.var.db);

  await db.run(`DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?`, [collectionId, productId]);

  return c.json({ ok: true as const }, 200);
});

const reorderCollectionProducts = createRoute({
  method: 'put',
  path: '/{id}/products/reorder',
  tags: ['Collections'],
  summary: 'Reorder products in collection',
  security: [{ bearerAuth: [] }],
  middleware: [adminOnly] as const,
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ReorderCollectionProductsBody } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkResponse } }, description: 'Products reordered' },
    404: { content: { 'application/json': { schema: ErrorResponse } }, description: 'Not found' },
  },
});

app.openapi(reorderCollectionProducts, async (c) => {
  const { id } = c.req.valid('param');
  const { items } = c.req.valid('json');
  const db = getDb(c.var.db);

  const [collection] = await db.query<any>(`SELECT id FROM collections WHERE id = ?`, [id]);
  if (!collection) throw ApiError.notFound('Collection not found');

  for (const item of items) {
    await db.run(
      `UPDATE collection_products SET sort_order = ? WHERE collection_id = ? AND product_id = ?`,
      [item.sort_order, id, item.product_id]
    );
  }

  return c.json({ ok: true as const }, 200);
});

export { app as collections };
