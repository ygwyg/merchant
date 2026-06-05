/**
 * Categories management admin page.
 *
 * Table view with inline editing, product assignment,
 * and CRUD operations for product categories.
 *
 * @author Basem Hegazy <basem.hegazy@outlook.com>
 */

import { useState, useMemo } from 'react';
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
  X,
} from 'lucide-react';
import { api, Category } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import clsx from 'clsx';

const columnHelper = createColumnHelper<Category>();

export function Categories() {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'sort_order', desc: false }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createModal, setCreateModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSortOrder, setNewSortOrder] = useState('0');

  // Add products form state
  const [addProductSearch, setAddProductSearch] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['categories', statusFilter],
    queryFn: () => api.getCategories({ limit: 100, status: statusFilter || undefined }),
  });

  const allProducts = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.getProducts({ limit: 200 }),
    enabled: !!selectedCategory,
  });

  const categories = data?.items || [];

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; sort_order?: number }) => api.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setCreateModal(false);
      setNewName('');
      setNewDescription('');
      setNewSortOrder('0');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateCategory>[1] }) =>
      api.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      refreshDetail();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setSelectedCategory(null);
      setSelectedDetail(null);
    },
  });

  const addProductsMutation = useMutation({
    mutationFn: ({ id, product_ids }: { id: string; product_ids: string[] }) =>
      api.addCategoryProducts(id, product_ids),
    onSuccess: () => {
      refreshDetail();
      setSelectedProductIds([]);
      setAddProductSearch('');
    },
  });

  const removeProductMutation = useMutation({
    mutationFn: ({ id, productId }: { id: string; productId: string }) =>
      api.removeCategoryProduct(id, productId),
    onSuccess: () => {
      refreshDetail();
    },
  });

  const refreshDetail = () => {
    if (selectedCategory) {
      api.getCategory(selectedCategory.id).then(setSelectedDetail);
    }
  };

  const handleSelectCategory = async (cat: Category) => {
    setSelectedCategory(cat);
    const detail = await api.getCategory(cat.id);
    setSelectedDetail(detail);
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: newName,
      description: newDescription || undefined,
      sort_order: parseInt(newSortOrder, 10) || 0,
    });
  };

  const handleAddProducts = () => {
    if (!selectedCategory || selectedProductIds.length === 0) return;
    addProductsMutation.mutate({ id: selectedCategory.id, product_ids: selectedProductIds });
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const confirmDelete = (cat: Category) => {
    if (window.confirm(`Delete category "${cat.name}"? This will unlink all products.`)) {
      deleteMutation.mutate(cat.id);
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
      }),
      columnHelper.accessor('slug', {
        header: 'Slug',
        cell: (info) => <span className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>{info.getValue()}</span>,
      }),
      columnHelper.accessor('sort_order', {
        header: 'Order',
        cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
      }),
      columnHelper.accessor('product_count', {
        header: 'Products',
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
    data: categories,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const productsInCategory = selectedDetail?.products || [];
  const allProductsList = allProducts.data?.items || [];
  const filteredProducts = allProductsList.filter(
    (p) =>
      !productsInCategory.some((pc: any) => pc.id === p.id) &&
      (addProductSearch === '' || p.title.toLowerCase().includes(addProductSearch.toLowerCase()))
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 h-9">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
          Categories
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['categories'] })}
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
            Add Category
          </button>
        </div>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex-1 flex items-center gap-2 px-4 py-3" style={{ color: 'var(--text-muted)' }}>
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

        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : categories.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No categories yet
          </div>
        ) : (
          <table className="w-full">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                      className={clsx(
                        'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide',
                        header.column.getCanSort() && 'cursor-pointer select-none hover:bg-[var(--bg-hover)]'
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
                  onClick={() => handleSelectCategory(row.original)}
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

      {/* Create Modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="New Category" size="md">
        <form onSubmit={handleCreateCategory} className="space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
              Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Category name"
              required
              className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
              Description (optional)
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description"
              rows={2}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2 resize-none"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
              Sort Order
            </label>
            <input
              type="number"
              value={newSortOrder}
              onChange={(e) => setNewSortOrder(e.target.value)}
              min="0"
              className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="flex gap-2 justify-end pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
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

      {/* Detail Modal */}
      <Modal
        open={!!selectedDetail}
        onClose={() => { setSelectedCategory(null); setSelectedDetail(null); }}
        title={selectedDetail?.name || 'Category'}
        size="lg"
      >
        {selectedDetail && (
          <div className="space-y-5">
            {/* Core fields */}
            <div className="p-3 rounded-lg space-y-3" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Name
                  </label>
                  <input
                    type="text"
                    defaultValue={selectedDetail.name}
                    onBlur={(e) => {
                      if (e.target.value !== selectedDetail.name) {
                        updateMutation.mutate({ id: selectedDetail.id, data: { name: e.target.value } });
                      }
                    }}
                    className="w-full px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Status
                  </label>
                  <select
                    value={selectedDetail.status}
                    onChange={(e) => updateMutation.mutate({ id: selectedDetail.id, data: { status: e.target.value } })}
                    disabled={updateMutation.isPending}
                    className="px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Sort Order
                  </label>
                  <input
                    type="number"
                    defaultValue={selectedDetail.sort_order}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val !== selectedDetail.sort_order) {
                        updateMutation.mutate({ id: selectedDetail.id, data: { sort_order: val } });
                      }
                    }}
                    min="0"
                    className="w-20 px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Description
                </label>
                <textarea
                  defaultValue={selectedDetail.description || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (selectedDetail.description || '')) {
                      updateMutation.mutate({ id: selectedDetail.id, data: { description: e.target.value } });
                    }
                  }}
                  placeholder="Add a description..."
                  rows={2}
                  className="w-full px-3 py-2 font-mono text-sm rounded-lg focus:outline-none focus:ring-2 resize-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </div>
            </div>

            {/* Products */}
            <div className="p-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                  Products ({productsInCategory.length})
                </h4>
              </div>

              {productsInCategory.length === 0 ? (
                <p className="font-mono text-sm py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
                  No products in this category
                </p>
              ) : (
                <div className="space-y-2 mb-4">
                  {productsInCategory.map((p: any) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="w-8 h-8 object-cover rounded" style={{ border: '1px solid var(--border)' }} />
                        ) : (
                          <div className="w-8 h-8 rounded" style={{ background: 'var(--bg-content)', border: '1px solid var(--border)' }} />
                        )}
                        <span className="font-mono text-sm truncate">{p.title}</span>
                      </div>
                      <button
                        onClick={() => removeProductMutation.mutate({ id: selectedDetail.id, productId: p.id })}
                        className="p-1 hover:bg-red-500/10 rounded transition-colors"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add products */}
              <div className="space-y-2">
                <input
                  type="text"
                  value={addProductSearch}
                  onChange={(e) => setAddProductSearch(e.target.value)}
                  placeholder="Search products to add..."
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg focus:outline-none focus:ring-2"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {filteredProducts.slice(0, 20).map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--bg-hover)] text-sm font-mono"
                      style={{ color: 'var(--text)' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(p.id)}
                        onChange={() => toggleProductSelection(p.id)}
                        className="rounded"
                      />
                      {p.title}
                    </label>
                  ))}
                  {filteredProducts.length === 0 && addProductSearch && (
                    <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>No matching products</p>
                  )}
                </div>
                {selectedProductIds.length > 0 && (
                  <button
                    onClick={handleAddProducts}
                    disabled={addProductsMutation.isPending}
                    className="w-full px-3 py-2 text-sm font-semibold rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: 'white' }}
                  >
                    {addProductsMutation.isPending ? 'Adding...' : `Add ${selectedProductIds.length} product(s)`}
                  </button>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => confirmDelete(selectedDetail)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-red-500/10"
                style={{ color: 'red' }}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Category'}
              </button>
              <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                Created {new Date(selectedDetail.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
