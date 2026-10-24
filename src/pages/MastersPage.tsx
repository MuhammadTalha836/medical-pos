import React, { useState, useEffect } from 'react';
import { api } from '../services/apiService';
import { Product, Company, SystemSettings } from '../types';
import { Modal } from '../components/common/Modal';
import { useAuthStore } from '../store/useAuthStore';
import {
  Package,
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { moneyFormatter } from '../utils/format';

interface MastersPageProps {
  settings?: SystemSettings | null;
}

export const MastersPage: React.FC<MastersPageProps> = ({ settings }) => {
  const { hasPermission } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'products' | 'companies'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string>('');

  // Modals
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    company_id: '',
    c_code: '',
    p_code: '',
    barcode: '',
    name: '',
    generic_name: '',
    unit_type: 'Tablets',
    packing: 100,
    box_trade_price: 0,
    box_retail_price: 0,
    unit_trade_price: 0,
    unit_retail_price: 0,
    default_discount_pct: 0,
    location_rack: '',
    stock_boxes: 0,
    stock_loose: 0,
    min_stock_alert: 10,
    allow_open_sale: true,
    min_sale_qty: 1
  });

  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState({
    code: '',
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  });

  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const money = moneyFormatter(settings);

  const loadData = async () => {
    try {
      setLoading(true);
      const [prods, comps] = await Promise.all([
        api.getProducts({
          q: searchQuery.trim() || undefined,
          company_id: selectedCompanyFilter ? Number(selectedCompanyFilter) : undefined
        }),
        api.getCompanies()
      ]);
      setProducts(prods);
      setCompanies(comps);
    } catch (err) {
      console.error('Failed to load masters data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCompanyFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  // Live calculation of unit trade price and PP unit
  const handleProductBoxPricingChange = (boxTrade: number, boxRetail: number, packing: number) => {
    const safePacking = Math.max(1, packing);
    const unitTrade = Number((boxTrade / safePacking).toFixed(2));
    const unitRetail = Number((boxRetail / safePacking).toFixed(2));

    setProductForm(prev => ({
      ...prev,
      box_trade_price: boxTrade,
      box_retail_price: boxRetail,
      packing: safePacking,
      unit_trade_price: unitTrade,
      unit_retail_price: unitRetail
    }));
  };

  const handleOpenAddProduct = () => {
    setEditingProduct(null);
    setProductForm({
      company_id: companies[0] ? String(companies[0].id) : '',
      c_code: companies[0] ? companies[0].code : '',
      p_code: `P-${Date.now().toString().slice(-5)}`,
      barcode: '',
      name: '',
      generic_name: '',
      unit_type: 'Tablets',
      packing: 100,
      box_trade_price: 100,
      box_retail_price: 120,
      unit_trade_price: 1.0,
      unit_retail_price: 1.2,
      default_discount_pct: 5,
      location_rack: 'Rack-A1',
      stock_boxes: 10,
      stock_loose: 0,
      min_stock_alert: 10,
      allow_open_sale: true,
      min_sale_qty: 1
    });
    setIsProductModalOpen(true);
  };

  const handleOpenEditProduct = (prod: Product) => {
    setEditingProduct(prod);
    setProductForm({
      company_id: prod.company_id ? String(prod.company_id) : '',
      c_code: prod.c_code,
      p_code: prod.p_code,
      barcode: prod.barcode || '',
      name: prod.name,
      generic_name: prod.generic_name || '',
      unit_type: prod.unit_type,
      packing: prod.packing,
      box_trade_price: prod.box_trade_price,
      box_retail_price: prod.box_retail_price,
      unit_trade_price: prod.unit_trade_price,
      unit_retail_price: prod.unit_retail_price,
      default_discount_pct: prod.default_discount_pct,
      location_rack: prod.location_rack || '',
      stock_boxes: prod.stock_boxes,
      stock_loose: prod.stock_loose,
      min_stock_alert: prod.min_stock_alert,
      allow_open_sale: prod.allow_open_sale === undefined ? true : (prod.allow_open_sale === 1 || prod.allow_open_sale === true),
      min_sale_qty: prod.min_sale_qty || 1
    });
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const selectedCompany = companies.find(c => String(c.id) === productForm.company_id);
      const payload: any = {
        ...productForm,
        company_id: productForm.company_id ? Number(productForm.company_id) : null,
        c_code: selectedCompany ? selectedCompany.code : (productForm.c_code || 'GEN'),
        packing: Number(productForm.packing),
        box_trade_price: Number(productForm.box_trade_price),
        box_retail_price: Number(productForm.box_retail_price),
        unit_trade_price: Number(productForm.unit_trade_price),
        unit_retail_price: Number(productForm.unit_retail_price),
        default_discount_pct: Number(productForm.default_discount_pct),
        stock_boxes: Number(productForm.stock_boxes),
        stock_loose: Number(productForm.stock_loose),
        min_stock_alert: Number(productForm.min_stock_alert),
        allow_open_sale: productForm.allow_open_sale ? 1 : 0,
        min_sale_qty: Math.max(1, Number(productForm.min_sale_qty) || 1)
      };

      if (editingProduct) {
        await api.updateProduct(editingProduct.id, payload);
        setFeedbackMessage(`Product "${payload.name}" updated successfully.`);
      } else {
        await api.createProduct(payload);
        setFeedbackMessage(`Product "${payload.name}" created successfully.`);
      }

      setIsProductModalOpen(false);
      loadData();
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (err: any) {
      alert('Error saving product: ' + err.message);
    }
  };

  const handleDeleteProduct = async (id: number, name: string) => {
    if (confirm(`Are you sure you want to delete product "${name}"?`)) {
      try {
        await api.deleteProduct(id);
        setFeedbackMessage(`Product "${name}" deleted.`);
        loadData();
        setTimeout(() => setFeedbackMessage(null), 4000);
      } catch (err: any) {
        alert('Delete failed: ' + err.message);
      }
    }
  };

  // Company management handlers
  const handleOpenAddCompany = () => {
    setEditingCompany(null);
    setCompanyForm({ code: '', name: '', contact_person: '', phone: '', email: '', address: '' });
    setIsCompanyModalOpen(true);
  };

  const handleOpenEditCompany = (c: Company) => {
    setEditingCompany(c);
    setCompanyForm({
      code: c.code,
      name: c.name,
      contact_person: c.contact_person || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || ''
    });
    setIsCompanyModalOpen(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCompany) {
        await api.updateCompany(editingCompany.id, companyForm);
        setFeedbackMessage(`Company "${companyForm.name}" updated successfully.`);
      } else {
        await api.createCompany(companyForm);
        setFeedbackMessage(`Company "${companyForm.name}" registered successfully.`);
      }
      setIsCompanyModalOpen(false);
      loadData();
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (err: any) {
      alert('Error saving company: ' + err.message);
    }
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Masters & Coding Module</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage pharmaceutical manufacturers, products, packaging, and shelf locations</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-2 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-1 rounded-xl shadow-xs">
          <button
            onClick={() => setActiveTab('products')}
            className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'products'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Products Catalog ({products.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('companies')}
            className={`flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'companies'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Companies / Suppliers ({companies.length})</span>
          </button>
        </div>
      </div>

      {feedbackMessage && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* PRODUCTS TAB */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs">
            <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[260px] flex items-center space-x-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Name, Generic, C-Code, or P-Code..."
                  className="field-input w-full pl-10 pr-4"
                />
              </div>

              <select
                value={selectedCompanyFilter}
                onChange={(e) => setSelectedCompanyFilter(e.target.value)}
                className="field-select"
              >
                <option value="">All Companies</option>
                {companies.map(c => (
                  <option key={c.id} value={c.code}>{c.code} - {c.name}</option>
                ))}
              </select>

              <button
                type="submit"
                className="btn-secondary"
              >
                Search
              </button>
            </form>

            {hasPermission('can_add_product') && (
              <button
                onClick={handleOpenAddProduct}
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Medicine</span>
              </button>
            )}
          </div>

          {/* Products Table */}
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-surface-inset-dark text-slate-600 dark:text-slate-400 font-semibold text-2xs border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-3">C-Code</th>
                    <th className="py-3 px-3">P-Code</th>
                    <th className="py-3 px-3">Medicine Name & Generic</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3 text-center">Packing</th>
                    <th className="py-3 px-3 text-right">T-Price</th>
                    <th className="py-3 px-3 text-right">MRP / Box</th>
                    <th className="py-3 px-3 text-right">PP Unit</th>
                    <th className="py-3 px-3 text-center">Loc</th>
                    <th className="py-3 px-3 text-center">Stock</th>
                    <th className="py-3 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {loading ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500 dark:text-slate-400">
                        <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                        <span>Loading Products Catalog...</span>
                      </td>
                    </tr>
                  ) : products.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-400 dark:text-slate-500">
                        No medicines found. Click "Add New Medicine" to create your first item.
                      </td>
                    </tr>
                  ) : (
                    products.map((prod, idx) => {
                      const isLow = prod.stock_boxes <= prod.min_stock_alert;
                      const isOut = prod.stock_boxes === 0 && prod.stock_loose === 0;

                      return (
                        <tr
                          key={prod.id}
                          className={`transition-colors ${
                            idx % 2 === 0
                              ? 'bg-transparent'
                              : 'bg-slate-50/70 dark:bg-surface-inset-dark/40'
                          } hover:bg-teal-50/50 dark:hover:bg-teal-950/20`}
                        >
                          <td className="py-3 px-3 font-mono font-bold text-teal-600 dark:text-teal-300">
                            {prod.c_code}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                            {prod.p_code}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900 dark:text-white">{prod.name}</div>
                            {prod.generic_name && (
                              <div className="text-2xs text-slate-500 dark:text-slate-400">{prod.generic_name}</div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="px-2 py-0.5 rounded-sm text-2xs bg-slate-100 dark:bg-surface-inset-dark text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                                {prod.unit_type}
                              </span>
                              {prod.allow_open_sale === 0 || prod.allow_open_sale === false ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 whitespace-nowrap" title="Must be sold in complete original packaging only">
                                  Full Pack Only
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 whitespace-nowrap" title={`Loose sales allowed (Min: ${prod.min_sale_qty || 1})`}>
                                  Open Sale: Yes{prod.min_sale_qty && prod.min_sale_qty > 1 ? ` (Min ${prod.min_sale_qty})` : ''}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center font-mono text-slate-700 dark:text-slate-300">
                            {prod.packing}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-500 dark:text-slate-400">
                            {money(prod.box_trade_price)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {money(prod.box_retail_price)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-300 font-semibold">
                            {money(prod.unit_retail_price)}
                          </td>
                          <td className="py-3 px-3 text-center font-mono text-slate-600 dark:text-slate-400">
                            {prod.location_rack || '-'}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
                              isOut
                                ? 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                                : isLow
                                ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            }`}>
                              {prod.stock_boxes} Bx, {prod.stock_loose} L
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              {hasPermission('can_edit_product') && (
                                <button
                                  onClick={() => handleOpenEditProduct(prod)}
                                  className="btn-secondary"
                                  title="Edit Medicine"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              )}
                              {hasPermission('can_delete_product') && (
                                <button
                                  onClick={() => handleDeleteProduct(prod.id, prod.name)}
                                  className="btn-danger"
                                  title="Delete Medicine"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                              {!hasPermission('can_edit_product') && !hasPermission('can_delete_product') && (
                                <span className="text-2xs text-slate-400 italic">View Only</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* COMPANIES TAB */}
      {activeTab === 'companies' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Registered Pharmaceutical Companies / Distributors</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Companies map to short C-Codes used across sales and inventory</p>
            </div>
            {hasPermission('can_add_company') && (
              <button
                onClick={handleOpenAddCompany}
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />
                <span>Add Company</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.map(c => (
              <div key={c.id} className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-teal-500/40 transition-all space-y-3 shadow-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="px-2 py-0.5 text-xs font-mono font-bold bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-sm">
                      C-Code: {c.code}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1.5">{c.name}</h3>
                  </div>
                  <div className="flex space-x-1">
                    {hasPermission('can_edit_company') ? (
                      <button
                        onClick={() => handleOpenEditCompany(c)}
                        className="btn-secondary"
                        title="Edit Company"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-2xs text-slate-400 italic">View Only</span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  {c.contact_person && <div>Contact: <span className="text-slate-800 dark:text-slate-200 font-medium">{c.contact_person}</span></div>}
                  {c.phone && <div>Phone: <span className="text-slate-800 dark:text-slate-200 font-mono">{c.phone}</span></div>}
                  {c.email && <div>Email: <span className="text-slate-800 dark:text-slate-200">{c.email}</span></div>}
                  {c.address && <div>Address: <span className="text-slate-800 dark:text-slate-200">{c.address}</span></div>}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                  <span>Linked Products:</span>
                  <span className="font-mono font-bold text-teal-600 dark:text-teal-400">{c.product_count || 0}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      <Modal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        title={editingProduct ? `Edit Product: ${editingProduct.name}` : 'Register New Medicine Product'}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Company (C-Code)</label>
              <select
                required
                value={productForm.company_id}
                onChange={(e) => {
                  const comp = companies.find(c => String(c.id) === e.target.value);
                  setProductForm(prev => ({
                    ...prev,
                    company_id: e.target.value,
                    c_code: comp ? comp.code : prev.c_code
                  }));
                }}
                className="field-select w-full"
              >
                <option value="">Select Company</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">P-Code / SKU</label>
              <input
                type="text"
                required
                value={productForm.p_code}
                onChange={(e) => setProductForm(prev => ({ ...prev, p_code: e.target.value.toUpperCase() }))}
                placeholder="e.g. PAN-500"
                className="field-input w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Barcode (Optional)</label>
              <input
                type="text"
                value={productForm.barcode}
                onChange={(e) => setProductForm(prev => ({ ...prev, barcode: e.target.value }))}
                placeholder="Scan or type barcode"
                className="field-input w-full font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Medicine Brand Name</label>
              <input
                type="text"
                required
                value={productForm.name}
                onChange={(e) => setProductForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Panadol Extra 500mg"
                className="field-input w-full font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Generic Formula</label>
              <input
                type="text"
                value={productForm.generic_name}
                onChange={(e) => setProductForm(prev => ({ ...prev, generic_name: e.target.value }))}
                placeholder="e.g. Paracetamol + Caffeine"
                className="field-input w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Location Rack (Loc)</label>
              <input
                type="text"
                value={productForm.location_rack}
                onChange={(e) => setProductForm(prev => ({ ...prev, location_rack: e.target.value }))}
                placeholder="e.g. Rack-A1"
                className="field-input w-full font-mono"
              />
            </div>
          </div>

          {/* Requirement 6: Packaging & Open-Sale Policy */}
          <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                <Package className="w-4 h-4" />
                Packaging & Open-Sale Policy
              </span>
              {!(editingProduct ? hasPermission('can_edit_product') : hasPermission('can_add_product')) && (
                <span className="text-2xs text-amber-500 font-medium">Read-only (Authorization required)</span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Sale Unit
                </label>
                <select
                  value={productForm.unit_type}
                  disabled={!(editingProduct ? hasPermission('can_edit_product') : hasPermission('can_add_product'))}
                  onChange={(e) => setProductForm(prev => ({ ...prev, unit_type: e.target.value }))}
                  className="field-select w-full"
                >
                  <option value="Tablets">Tablets</option>
                  <option value="Capsules">Capsules</option>
                  <option value="Strip">Strip</option>
                  <option value="Box">Box</option>
                  <option value="Bottle">Bottle</option>
                  <option value="Syrup">Syrup</option>
                  <option value="Suspension">Suspension</option>
                  <option value="Injection">Injection</option>
                  <option value="Drops">Drops</option>
                  <option value="Sachet">Sachet</option>
                  <option value="Ointment">Ointment</option>
                  <option value="Inhaler">Inhaler</option>
                  <option value="Unit">Unit</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Units per Pack / Box
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  disabled={!(editingProduct ? hasPermission('can_edit_product') : hasPermission('can_add_product'))}
                  value={productForm.packing}
                  onChange={(e) => handleProductBoxPricingChange(productForm.box_trade_price, productForm.box_retail_price, parseInt(e.target.value) || 1)}
                  className="field-input w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Allow Open Sale?
                </label>
                <select
                  value={productForm.allow_open_sale ? 'yes' : 'no'}
                  disabled={!(editingProduct ? hasPermission('can_edit_product') : hasPermission('can_add_product'))}
                  onChange={(e) => setProductForm(prev => ({ ...prev, allow_open_sale: e.target.value === 'yes' }))}
                  className={`field-select w-full font-semibold ${
                    productForm.allow_open_sale
                      ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                      : 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  <option value="yes">Yes (Allow Loose Units)</option>
                  <option value="no">No (Complete Packaging Only)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Min Sale Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  disabled={!(editingProduct ? hasPermission('can_edit_product') : hasPermission('can_add_product'))}
                  value={productForm.min_sale_qty}
                  onChange={(e) => setProductForm(prev => ({ ...prev, min_sale_qty: Math.max(1, parseInt(e.target.value) || 1) }))}
                  className="field-input w-full font-mono"
                  placeholder="1"
                />
              </div>
            </div>

            {/* Interactive Stock Conversion & Inventory Impact Card */}
            <div className={`p-3 rounded-lg border text-xs transition-colors ${
              productForm.allow_open_sale
                ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200'
                : 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
            }`}>
              <div className="font-bold flex items-center gap-1.5 mb-1.5">
                <span className="text-sm">{productForm.allow_open_sale ? '⚡' : '🔒'}</span>
                <span>Stock Conversion & Sales Rules:</span>
              </div>
              {productForm.allow_open_sale ? (
                <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <p>
                    • <strong>Full Pack:</strong> 1 Box contains <strong>{productForm.packing}</strong> individual {productForm.unit_type.toLowerCase()}. Selling 1 Box deducts 1 full box ({productForm.packing} units) from stock.
                  </p>
                  <p>
                    • <strong>Loose Units:</strong> Cashiers can sell individual {productForm.unit_type.toLowerCase()} at <strong>{money(productForm.unit_retail_price)}</strong> each. Loose sales deduct directly from loose stock (or auto-convert 1 whole box when loose stock is 0).
                  </p>
                  <p>
                    • <strong>Minimum Sale Rule:</strong> Cashiers cannot sell less than <strong>{productForm.min_sale_qty}</strong> unit(s) per transaction.
                  </p>
                </div>
              ) : (
                <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <p>
                    • <strong>Complete Packaging Only:</strong> This medicine <em>cannot</em> be sold as individual loose units. Loose unit sales are strictly blocked at POS counter.
                  </p>
                  <p>
                    • <strong>Stock Impact:</strong> Every sale deducts complete packs (1 pack = 1 box of {productForm.packing} units) at <strong>{money(productForm.box_retail_price)}</strong>.
                  </p>
                  <p>
                    • <strong>Minimum Sale Rule:</strong> Cashiers cannot sell less than <strong>{productForm.min_sale_qty}</strong> pack(s).
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Pricing Grid */}
          <div className="bg-slate-50 dark:bg-surface-inset-dark border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-3">
            <span className="text-xs font-bold text-teal-700 dark:text-teal-400 block">Pricing & Margin Details</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Box Trade Price (T-Price)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={productForm.box_trade_price}
                  onChange={(e) => handleProductBoxPricingChange(parseFloat(e.target.value) || 0, productForm.box_retail_price, productForm.packing)}
                  className="field-input field-sm w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Box Retail Price (MRP)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={productForm.box_retail_price}
                  onChange={(e) => handleProductBoxPricingChange(productForm.box_trade_price, parseFloat(e.target.value) || 0, productForm.packing)}
                  className="field-input field-sm w-full font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs text-teal-700 dark:text-teal-300 font-semibold mb-1">PP Unit (Per Unit Price)</label>
                <input
                  type="number"
                  step="0.01"
                  value={productForm.unit_retail_price}
                  onChange={(e) => setProductForm(prev => ({ ...prev, unit_retail_price: parseFloat(e.target.value) || 0 }))}
                  className="field-input field-sm w-full font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">Default Discount %</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={productForm.default_discount_pct}
                  onChange={(e) => setProductForm(prev => ({ ...prev, default_discount_pct: parseFloat(e.target.value) || 0 }))}
                  className="field-input field-sm w-full font-mono"
                />
              </div>
            </div>
          </div>

          {/* Stock Counts */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Stock (Boxes)</label>
              <input
                type="number"
                min="0"
                value={productForm.stock_boxes}
                onChange={(e) => setProductForm(prev => ({ ...prev, stock_boxes: parseInt(e.target.value) || 0 }))}
                className="field-input w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Stock (Loose Units)</label>
              <input
                type="number"
                min="0"
                value={productForm.stock_loose}
                onChange={(e) => setProductForm(prev => ({ ...prev, stock_loose: parseInt(e.target.value) || 0 }))}
                className="field-input w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Min Stock Alert Level</label>
              <input
                type="number"
                min="1"
                value={productForm.min_stock_alert}
                onChange={(e) => setProductForm(prev => ({ ...prev, min_stock_alert: parseInt(e.target.value) || 10 }))}
                className="field-input w-full font-mono font-semibold"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsProductModalOpen(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
            >
              {editingProduct ? 'Update Product' : 'Save Medicine'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Company Modal */}
      <Modal
        isOpen={isCompanyModalOpen}
        onClose={() => setIsCompanyModalOpen(false)}
        title={editingCompany ? `Edit Company: ${editingCompany.name}` : 'Register New Pharmaceutical Company / Supplier'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveCompany} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Company Code (C-Code, e.g. GSK, ABT)</label>
            <input
              type="text"
              required
              value={companyForm.code}
              onChange={(e) => setCompanyForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
              placeholder="e.g. GSK"
              className="field-input w-full font-mono font-bold"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Company Full Name</label>
            <input
              type="text"
              required
              value={companyForm.name}
              onChange={(e) => setCompanyForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. GlaxoSmithKline Pakistan"
              className="field-input w-full"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Contact Person</label>
            <input
              type="text"
              value={companyForm.contact_person}
              onChange={(e) => setCompanyForm(prev => ({ ...prev, contact_person: e.target.value }))}
              placeholder="e.g. Regional Distributor"
              className="field-input w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone</label>
              <input
                type="text"
                value={companyForm.phone}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="+92..."
                className="field-input w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Email</label>
              <input
                type="email"
                value={companyForm.email}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="supply@..."
                className="field-input w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Address</label>
            <input
              type="text"
              value={companyForm.address}
              onChange={(e) => setCompanyForm(prev => ({ ...prev, address: e.target.value }))}
              placeholder="Industrial Zone / Warehouse Location"
              className="field-input w-full"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsCompanyModalOpen(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
            >
              {editingCompany ? 'Update Company' : 'Save Company'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
