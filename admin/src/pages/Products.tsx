import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
  RefreshCw,
  Plus,
  ArrowLeft,
  ImageIcon,
  Upload,
  X,
  Pencil,
} from 'lucide-react';
import { api, Product, Variant } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import clsx from 'clsx';

const columnHelper = createColumnHelper<Product>();

export function Products() {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modals
  const [createModal, setCreateModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [variantMode, setVariantMode] = useState<'add' | 'edit' | null>(null);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [variantSku, setVariantSku] = useState('');
  const [variantTitle, setVariantTitle] = useState('');
  const [variantPrice, setVariantPrice] = useState('');
  const [variantCost, setVariantCost] = useState('');
  const [variantImage, setVariantImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [productCostValue, setProductCostValue] = useState('');
  const pendingCost = useRef<number | null>(null);

  // Fetch products
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['products', statusFilter],
    queryFn: () => api.getProducts({ limit: 100, status: statusFilter || undefined }),
  });

  const products = data?.items || [];

  // Create product mutation
  const createMutation = useMutation({
    mutationFn: (data: { title: string; description?: string }) => api.createProduct(data),
    onSuccess: (product) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setCreateModal(false);
      setNewTitle('');
      setNewDescription('');
      setSelectedProduct(product);
    },
  });

  // Create variant mutation
  const createVariantMutation = useMutation({
    mutationFn: ({
      productId,
      data,
    }: {
      productId: string;
      data: Parameters<typeof api.createVariant>[1];
    }) => api.createVariant(productId, data),
    onSuccess: (variant) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (pendingCost.current !== null && pendingCost.current >= 0 && selectedProduct) {
        setVariantCostMutation.mutate({
          productId: selectedProduct.id,
          variantId: variant.id,
          cost_cents: pendingCost.current,
        });
        pendingCost.current = null;
      }
      refreshSelectedProduct();
      resetVariantForm();
      setVariantMode(null);
    },
  });

  // Update product mutation
  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateProduct>[1] }) =>
      api.updateProduct(id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedProduct(updated);
    },
  });

  // Update variant mutation
  const updateVariantMutation = useMutation({
    mutationFn: ({
      productId,
      variantId,
      data,
    }: {
      productId: string;
      variantId: string;
      data: Parameters<typeof api.updateVariant>[2];
    }) => api.updateVariant(productId, variantId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      refreshSelectedProduct();
      resetVariantForm();
      setVariantMode(null);
      setEditingVariant(null);
    },
  });

  // Product cost mutation
  const setProductCostMutation = useMutation({
    mutationFn: ({ id, cost_cents }: { id: string; cost_cents: number }) =>
      api.setProductCost(id, cost_cents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  // Variant cost mutation
  const setVariantCostMutation = useMutation({
    mutationFn: ({ productId, variantId, cost_cents }: { productId: string; variantId: string; cost_cents: number }) =>
      api.setVariantCost(productId, variantId, cost_cents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const refreshSelectedProduct = () => {
    if (selectedProduct) {
      api.getProduct(selectedProduct.id).then(setSelectedProduct);
    }
  };

  // Load stored cost when a product is selected for editing
  useEffect(() => {
    if (selectedProduct) {
      api.getProductCosts(selectedProduct.id).then((costs) => {
        setProductCostValue(costs.product_cost ? String(costs.product_cost.cost_cents) : '');
      }).catch(() => setProductCostValue(''));
    } else {
      setProductCostValue('');
    }
  }, [selectedProduct?.id]);

  const resetVariantForm = () => {
    setVariantSku('');
    setVariantTitle('');
    setVariantPrice('');
    setVariantCost('');
    setVariantImage(null);
  };

  const openEditVariant = (variant: Variant) => {
    setEditingVariant(variant);
    setVariantSku(variant.sku);
    setVariantTitle(variant.title);
    setVariantPrice(String(variant.price_cents));
    setVariantCost('');
    setVariantImage(variant.image_url);
    setVariantMode('edit');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const result = await api.uploadImage(file);
      setVariantImage(result.url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ title: newTitle, description: newDescription || undefined });
  };

  const handleVariantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    const price = parseInt(variantPrice, 10);
    if (isNaN(price)) return;
    const cost = variantCost ? parseInt(variantCost, 10) : null;

    if (variantMode === 'edit' && editingVariant) {
      updateVariantMutation.mutate({
        productId: selectedProduct.id,
        variantId: editingVariant.id,
        data: {
          sku: variantSku,
          title: variantTitle,
          price_cents: price,
          image_url: variantImage,
        },
      });
      if (cost !== null && !isNaN(cost) && cost >= 0) {
        setVariantCostMutation.mutate({
          productId: selectedProduct.id,
          variantId: editingVariant.id,
          cost_cents: cost,
        });
      }
    } else {
      pendingCost.current = (cost !== null && !isNaN(cost) && cost >= 0) ? cost : null;
      createVariantMutation.mutate({
        productId: selectedProduct.id,
        data: {
          sku: variantSku,
          title: variantTitle,
          price_cents: price,
          image_url: variantImage || undefined,
        },
      });
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('title', {
        header: 'Product',
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
      }),
      columnHelper.accessor('description', {
        header: 'Description',
        cell: (info) => <span className="font-mono text-sm">{info.getValue() || '-'}</span>,
      }),
      columnHelper.accessor((row) => row.variants.length, {
        id: 'variants',
        header: 'Variants',
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: (info) => <StatusBadge status={info.getValue()} />,
      }),
    ],
    []
  );

  const table = useReactTable({
    data: products,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const isPending = createVariantMutation.isPending || updateVariantMutation.isPending;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 h-9">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          Products
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['products'] })}
            disabled={isFetching}
            className="p-2 rounded hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
            style={{ color: 'var(--text-muted)' }}
          >
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded font-semibold transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
          >
            <Plus size={16} />
            Add Product
          </button>
        </div>
      </div>

      {/* Table card */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        {/* Filters */}
        <div className="flex items-center border-b" style={{ borderColor: 'var(--border)' }}>
          <div
            className="flex-1 flex items-center gap-2 px-4 py-3"
            style={{ color: 'var(--text-muted)' }}
          >
            <Search size={16} className="flex-shrink-0" />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search..."
              className="bg-transparent border-0 font-mono text-sm w-full focus:outline-none"
              style={{ color: 'var(--text)' }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-full px-4 py-3 font-mono text-sm bg-transparent border-0 border-l focus:outline-none cursor-pointer"
            style={{
              borderColor: 'var(--border)',
              color: statusFilter ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : products.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No products yet
          </div>
        ) : (
          <table className="w-full">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={
                        header.column.getCanSort()
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      className={clsx(
                        'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide',
                        header.column.getCanSort() &&
                          'cursor-pointer select-none hover:bg-[var(--bg-hover)]'
                      )}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="ml-1">
                            {header.column.getIsSorted() === 'asc' ? (
                              <ChevronUp size={14} />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronsUpDown size={14} className="opacity-30" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedProduct(row.original)}
                  className="cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Product Modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="New Product" size="md">
        <form onSubmit={handleCreateProduct} className="space-y-4">
          <div>
            <label
              className="block text-xs font-medium uppercase tracking-wide mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Title
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Product title"
              required
              className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium uppercase tracking-wide mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Description (optional)
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description"
              rows={2}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2 resize-none"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            />
          </div>
          <div
            className="flex gap-2 justify-end pt-4 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setCreateModal(false)}
              className="px-4 py-2 text-sm font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Product Detail Modal */}
      <Modal
        open={!!selectedProduct && !variantMode}
        onClose={() => {
          setSelectedProduct(null);
          setVariantMode(null);
          setEditingVariant(null);
          resetVariantForm();
        }}
        title={selectedProduct?.title || 'Product'}
        size="lg"
      >
        {selectedProduct && (
          <div className="space-y-5">
            {/* Product Info */}
            <div className="p-3 rounded-lg space-y-3" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <label
                    className="block text-xs font-medium uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Title
                  </label>
                  <input
                    type="text"
                    defaultValue={selectedProduct.title}
                    onBlur={(e) => {
                      if (e.target.value !== selectedProduct.title) {
                        updateProductMutation.mutate({
                          id: selectedProduct.id,
                          data: { title: e.target.value },
                        });
                      }
                    }}
                    className="w-full px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Status
                  </label>
                  <select
                    value={selectedProduct.status}
                    onChange={(e) => {
                      updateProductMutation.mutate({
                        id: selectedProduct.id,
                        data: { status: e.target.value },
                      });
                    }}
                    disabled={updateProductMutation.isPending}
                    className="px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                  </select>
                </div>
                <div>
                  <label
                    className="block text-xs font-medium uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Default Cost (cents)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={productCostValue}
                    onChange={(e) => setProductCostValue(e.target.value)}
                    onBlur={(e) => {
                      const cost = parseInt(e.target.value, 10);
                      if (!isNaN(cost) && cost >= 0) {
                        setProductCostMutation.mutate({ id: selectedProduct.id, cost_cents: cost });
                      }
                    }}
                    placeholder="e.g. 1000"
                    className="w-full px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </div>
              <div>
                <label
                  className="block text-xs font-medium uppercase tracking-wide mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Description
                </label>
                <textarea
                  defaultValue={selectedProduct.description || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedProduct.description || '')) {
                      updateProductMutation.mutate({
                        id: selectedProduct.id,
                        data: { description: e.target.value },
                      });
                    }
                  }}
                  placeholder="Add a description..."
                  rows={2}
                  className="w-full px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2 resize-none"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>
            </div>

            {/* Variants */}
            <div className="p-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h4
                  className="text-xs font-medium uppercase tracking-wide"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Variants ({selectedProduct.variants.length})
                </h4>
                <button
                  onClick={() => setVariantMode('add')}
                  className="text-sm font-medium hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  + Add Variant
                </button>
              </div>

              {selectedProduct.variants.length === 0 ? (
                <p
                  className="font-mono text-sm py-6 text-center"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  No variants yet. Add one to start selling.
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedProduct.variants.map((v) => (
                    <VariantCard key={v.id} variant={v} onEdit={() => openEditVariant(v)} />
                  ))}
                </div>
              )}
            </div>

            {/* Meta */}
            <div
              className="text-xs font-mono pt-4 border-t"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Created {new Date(selectedProduct.created_at).toLocaleString()}
            </div>
          </div>
        )}
      </Modal>

      {/* Variant Form Modal */}
      <Modal
        open={!!selectedProduct && !!variantMode}
        onClose={() => {
          setVariantMode(null);
          setEditingVariant(null);
          resetVariantForm();
        }}
        title={variantMode === 'edit' ? 'Edit Variant' : 'Add Variant'}
        size="md"
      >
        {selectedProduct && variantMode && (
          <div>
            <button
              onClick={() => {
                setVariantMode(null);
                setEditingVariant(null);
                resetVariantForm();
              }}
              className="flex items-center gap-2 text-sm font-mono mb-5 hover:underline"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeft size={14} />
              Back to {selectedProduct.title}
            </button>

            <form onSubmit={handleVariantSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-xs font-medium uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    SKU
                  </label>
                  <input
                    type="text"
                    value={variantSku}
                    onChange={(e) => setVariantSku(e.target.value)}
                    placeholder="e.g. TEE-BLK-M"
                    required
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Price (cents)
                  </label>
                  <input
                    type="number"
                    value={variantPrice}
                    onChange={(e) => setVariantPrice(e.target.value)}
                    placeholder="e.g. 2999"
                    required
                    min="0"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium uppercase tracking-wide mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Cost (cents)
                  </label>
                  <input
                    type="number"
                    value={variantCost}
                    onChange={(e) => setVariantCost(e.target.value)}
                    placeholder="e.g. 1000"
                    min="0"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  className="block text-xs font-medium uppercase tracking-wide mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={variantTitle}
                  onChange={(e) => setVariantTitle(e.target.value)}
                  placeholder="e.g. Black / Medium"
                  required
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-xs font-medium uppercase tracking-wide mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Image (optional)
                </label>
                {variantImage ? (
                  <div className="relative inline-block">
                    <img
                      src={variantImage}
                      alt=""
                      className="w-20 h-20 object-cover rounded-lg"
                      style={{ border: '1px solid var(--border)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setVariantImage(null)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed rounded-lg cursor-pointer transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleImageUpload}
                      className="hidden"
                      disabled={uploadingImage}
                    />
                    {uploadingImage ? (
                      <Loader2
                        size={20}
                        className="animate-spin"
                        style={{ color: 'var(--text-muted)' }}
                      />
                    ) : (
                      <>
                        <Upload size={18} style={{ color: 'var(--text-muted)' }} />
                        <span
                          className="text-xs mt-1 font-mono"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Click to upload
                        </span>
                      </>
                    )}
                  </label>
                )}
              </div>

              <div
                className="flex gap-2 justify-end pt-4 border-t"
                style={{ borderColor: 'var(--border)' }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setVariantMode(null);
                    setEditingVariant(null);
                    resetVariantForm();
                  }}
                  className="px-4 py-2 text-sm font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  {isPending
                    ? variantMode === 'edit'
                      ? 'Saving...'
                      : 'Adding...'
                    : variantMode === 'edit'
                      ? 'Save'
                      : 'Add'}
                </button>
              </div>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}

function VariantCard({ variant, onEdit }: { variant: Variant; onEdit: () => void }) {
  return (
    <div
      onClick={onEdit}
      className="flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
    >
      {variant.image_url ? (
        <img
          src={variant.image_url}
          alt=""
          className="w-10 h-10 object-cover rounded"
          style={{ border: '1px solid var(--border)' }}
        />
      ) : (
        <div
          className="w-10 h-10 flex items-center justify-center rounded"
          style={{ background: 'var(--bg-content)', border: '1px solid var(--border)' }}
        >
          <ImageIcon size={16} style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm">{variant.title}</p>
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {variant.sku}
        </p>
      </div>
      <p className="font-mono text-sm">${(variant.price_cents / 100).toFixed(2)}</p>
      <Pencil size={14} style={{ color: 'var(--text-muted)' }} />
    </div>
  );
}
