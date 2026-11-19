import React, { useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Product, Settings } from '../types';
import { rp, uid } from '../utils/format';
import { ConfirmModal, Modal } from './Modal';

interface ProductsViewProps {
  products: Product[];
  settings: Settings;
  syncing: boolean;
  onSaveProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
  onPushProducts: () => Promise<void>;
  onToast: (msg: string, type?: 'ok' | 'err') => void;
}

export function ProductsView({
  products,
  settings,
  syncing,
  onSaveProduct,
  onDeleteProduct,
  onPushProducts,
  onToast,
}: ProductsViewProps) {
  const [search, setSearch] = useState('');
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => (p.name + ' ' + p.main).toLowerCase().includes(q));
  }, [products, search]);

  const openNew = () => {
    setIsNew(true);
    setEditProduct({ id: uid(), main: '', name: '', price: 0, active: true });
  };

  const openEdit = (p: Product) => {
    setIsNew(false);
    setEditProduct({ ...p });
  };

  const handleSave = () => {
    if (!editProduct) return;
    if (!editProduct.main.trim() || !editProduct.name.trim()) {
      onToast('Enter main category and product name', 'err');
      return;
    }
    onSaveProduct({
      ...editProduct,
      main: editProduct.main.trim(),
      name: editProduct.name.trim(),
      price: Number(editProduct.price) || 0,
    });
    setEditProduct(null);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink)]">Products</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products…"
              className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-medium text-[var(--ink)] outline-none focus:border-[var(--accent)] w-52"
            />
            {settings.gasUrl && (
              <button
                type="button"
                disabled={syncing}
                onClick={onPushProducts}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Push Products
              </button>
            )}
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold shadow-sm hover:bg-[var(--accent-hover)] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Product
            </button>
          </div>
        </div>

        <div className="theme-card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--bg)] border-b border-[var(--line)]">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Category
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Name
                </th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Price
                </th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--muted)] font-extrabold">
                  Status
                </th>
                <th className="w-32 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {!filtered.length ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-xs text-[var(--muted)]">
                    No products found.
                  </td>
                </tr>
              ) : (
                filtered.map(p => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--line-soft)] last:border-b-0 hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-4 py-3 text-xs font-semibold text-[var(--ink-2)]">{p.main}</td>
                    <td className="px-4 py-3 font-bold text-[var(--ink)]">{p.name}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                      {rp(p.price)}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      <span className={p.active !== false ? 'text-[var(--green)]' : 'text-[var(--muted)]'}>
                        {p.active !== false ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-xs font-bold text-[var(--ink-2)] hover:bg-[var(--surface-2)] cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(p.id)}
                          aria-label={`Delete ${p.name}`}
                          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--accent-soft)] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product Edit / Create Modal */}
      <Modal
        open={editProduct !== null}
        title={isNew ? 'New Product' : 'Edit Product'}
        onClose={() => setEditProduct(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditProduct(null)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-2)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer"
            >
              Save Product
            </button>
          </>
        }
      >
        {editProduct && (
          <>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
                Main Category
              </span>
              <input
                autoFocus
                type="text"
                value={editProduct.main}
                onChange={e => setEditProduct({ ...editProduct, main: e.target.value })}
                placeholder="e.g. Nasi Goreng"
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
                Product Name
              </span>
              <input
                type="text"
                value={editProduct.name}
                onChange={e => setEditProduct({ ...editProduct, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="block mb-3">
              <span className="block text-[11px] font-extrabold uppercase text-[var(--ink-2)] mb-1.5">
                Price (Rp)
              </span>
              <input
                type="number"
                value={editProduct.price}
                onChange={e => setEditProduct({ ...editProduct, price: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] text-sm font-bold text-[var(--ink)] tabular-nums outline-none focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </label>
            <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={editProduct.active !== false}
                onChange={e => setEditProduct({ ...editProduct, active: e.target.checked })}
                className="w-4 h-4 accent-[var(--accent)]"
              />
              <span className="text-sm font-semibold text-[var(--ink)]">Active on POS menu</span>
            </label>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        title="Delete Product"
        message="Delete this product from the menu?"
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId) onDeleteProduct(deleteId);
        }}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
}
