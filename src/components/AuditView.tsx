import React, { useMemo, useState } from 'react';
import { ShieldCheck, Filter, Receipt, ClipboardList, Wallet } from 'lucide-react';

// Local, minimal copies of the shared shapes this view reads — same convention already used
// by CompanySettingsView.tsx (each component declares only the fields it actually needs).
interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  salePrice: number;
}

interface Sale {
  id: string;
  items: SaleItem[];
  total: number;
  paymentMethod: 'Cash' | 'Card' | 'Transfer' | 'Credit';
  timestamp: string;
  createdAt?: number;
  status: 'Completed' | 'Refunded';
  branchId?: string;
  employeeName?: string;
  orderId?: string;
  tableId?: string;
  waiterName?: string;
}

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  destination: 'cocina' | 'barra' | 'ninguno';
  round: number;
  sentAt?: string;
}

interface Order {
  id: string;
  tableId: string;
  branchId: string;
  status: 'open' | 'closed';
  waiterId: string;
  waiterName: string;
  openedAt: string;
  items: OrderItem[];
  closedAt?: string;
  saleId?: string;
}

interface CashRegister {
  isOpen: boolean;
  initialCash: number;
  currentCash: number;
  transactions: {
    type: 'Ingreso' | 'Egreso' | 'Venta' | 'Transferencia';
    amount: number;
    description: string;
    time: string;
    createdAt?: number;
    branchId?: string;
  }[];
}

interface Branch {
  id: string;
  name: string;
}

interface Member {
  userId: string;
  name: string;
  role: 'owner' | 'master_admin' | 'admin' | 'employee' | 'mesero';
}

interface AuditViewProps {
  companyName: string;
  sales: Sale[];
  orders: Order[];
  cashRegisters: { [branchId: string]: CashRegister };
  branches: Branch[];
  members: Member[];
}

const formatMXN = (val: number): string => {
  if (isNaN(val) || val === undefined || val === null) return '$0.00 MXN';
  return `$${val.toFixed(2)} MXN`;
};

const orderTotal = (order: Order, salesById: Map<string, Sale>): number => {
  // Prefer the linked Sale's total (reflects discount/tax actually charged); fall back to
  // a raw sum of items for orders still open (no Sale yet) or missing/unmatched saleId.
  if (order.saleId) {
    const linkedSale = salesById.get(order.saleId);
    if (linkedSale) return linkedSale.total;
  }
  return order.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
};

// `Date.parse` returns NaN for the locale display strings some legacy fields still use —
// callers should prefer `createdAt`/ISO fields and treat this as a best-effort fallback.
const parseDateSafe = (value?: string): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return isNaN(parsed) ? null : parsed;
};

export default function AuditView({ companyName, sales, orders, cashRegisters, branches, members }: AuditViewProps) {
  const [waiterFilter, setWaiterFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const waiters = useMemo(() => members.filter(m => m.role === 'mesero'), [members]);

  const knownTableIds = useMemo(() => {
    const ids = new Set<string>();
    orders.forEach(o => o.tableId && ids.add(o.tableId));
    sales.forEach(s => s.tableId && ids.add(s.tableId));
    return Array.from(ids).sort();
  }, [orders, sales]);

  const branchName = (branchId?: string) => branches.find(b => b.id === branchId)?.name || branchId || '—';

  // Inclusive day-range bounds in epoch ms, or null if that side of the filter is unset.
  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
  const inDateRange = (ms: number | null) => {
    if (ms === null) return fromMs === null && toMs === null;
    if (fromMs !== null && ms < fromMs) return false;
    if (toMs !== null && ms > toMs) return false;
    return true;
  };

  const filteredSales = useMemo(() => sales.filter(s => {
    if (waiterFilter !== 'all' && s.waiterName !== waiterFilter) return false;
    if (branchFilter !== 'all' && s.branchId !== branchFilter) return false;
    if (tableFilter !== 'all' && s.tableId !== tableFilter) return false;
    if (!inDateRange(s.createdAt ?? parseDateSafe(s.timestamp))) return false;
    return true;
  }), [sales, waiterFilter, branchFilter, tableFilter, fromMs, toMs]);

  const filteredOrders = useMemo(() => orders.filter(o => {
    if (waiterFilter !== 'all' && o.waiterName !== waiterFilter) return false;
    if (branchFilter !== 'all' && o.branchId !== branchFilter) return false;
    if (tableFilter !== 'all' && o.tableId !== tableFilter) return false;
    if (!inDateRange(parseDateSafe(o.closedAt) ?? parseDateSafe(o.openedAt))) return false;
    return true;
  }), [orders, waiterFilter, branchFilter, tableFilter, fromMs, toMs]);

  const filteredCashMovements = useMemo(() => {
    const rows: { branchId: string; type: string; amount: number; description: string; time: string; createdAt?: number }[] = [];
    Object.entries(cashRegisters).forEach(([branchId, register]) => {
      (register.transactions || []).forEach(t => {
        if (branchFilter !== 'all' && branchId !== branchFilter) return;
        if (!inDateRange(t.createdAt ?? null)) return;
        rows.push({ branchId, ...t });
      });
    });
    rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return rows;
  }, [cashRegisters, branchFilter, fromMs, toMs]);

  const salesById = useMemo(() => new Map(sales.map(s => [s.id, s])), [sales]);
  const closedOrdersTotal = filteredOrders
    .filter(o => o.status === 'closed')
    .reduce((sum, o) => sum + orderTotal(o, salesById), 0);
  const salesTotal = filteredSales.reduce((sum, s) => sum + s.total, 0);

  const clearFilters = () => {
    setWaiterFilter('all');
    setBranchFilter('all');
    setTableFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white border border-slate-200 p-6 rounded-3xl shadow-xs text-left">
        <div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Panel de Administrador — Auditoría de {companyName}
          </h2>
          <p className="text-xs text-slate-500">Cruce de ventas, comandas y movimientos de caja de todas las sucursales.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-xs">
        <div className="flex items-center gap-2 mb-3 text-slate-700 font-black text-xs uppercase">
          <Filter className="w-4 h-4" /> Filtros
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Mesero</label>
            <select value={waiterFilter} onChange={e => setWaiterFilter(e.target.value)}
              className="w-full text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 outline-none focus:border-indigo-400 cursor-pointer">
              <option value="all">Todos</option>
              {waiters.map(w => <option key={w.userId} value={w.name}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Sucursal</label>
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
              className="w-full text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 outline-none focus:border-indigo-400 cursor-pointer">
              <option value="all">Todas</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Mesa</label>
            <select value={tableFilter} onChange={e => setTableFilter(e.target.value)}
              className="w-full text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 outline-none focus:border-indigo-400 cursor-pointer">
              <option value="all">Todas</option>
              {knownTableIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Desde</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 outline-none focus:border-indigo-400" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Hasta</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 outline-none focus:border-indigo-400" />
          </div>
        </div>
        {(waiterFilter !== 'all' || branchFilter !== 'all' || tableFilter !== 'all' || dateFrom || dateTo) && (
          <button type="button" onClick={clearFilters}
            className="mt-3 text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer">
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-xs">
          <p className="text-[10px] text-slate-500 font-bold uppercase">Ventas (filtro actual)</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{formatMXN(salesTotal)}</p>
          <p className="text-[11px] text-slate-400 font-medium">{filteredSales.length} transacciones</p>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-xs">
          <p className="text-[10px] text-slate-500 font-bold uppercase">Cuentas cerradas (filtro actual)</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{formatMXN(closedOrdersTotal)}</p>
          <p className="text-[11px] text-slate-400 font-medium">
            {filteredOrders.filter(o => o.status === 'closed').length} cerradas · {filteredOrders.filter(o => o.status === 'open').length} abiertas
          </p>
        </div>
        <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-xs">
          <p className="text-[10px] text-slate-500 font-bold uppercase">Movimientos de caja (filtro actual)</p>
          <p className="text-2xl font-black text-slate-800 mt-1">{filteredCashMovements.length}</p>
          <p className="text-[11px] text-slate-400 font-medium">Todas las sucursales visibles con el filtro</p>
        </div>
      </div>

      {/* Ventas */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 text-slate-700 font-black text-xs uppercase">
          <Receipt className="w-4 h-4" /> Ventas
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
              <tr>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">Mesero/Atendió</th>
                <th className="text-left px-4 py-2">Mesa</th>
                <th className="text-left px-4 py-2">Sucursal</th>
                <th className="text-left px-4 py-2">Método</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400 font-medium">Sin ventas para este filtro.</td></tr>
              ) : filteredSales.map(s => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-600">{s.timestamp}</td>
                  <td className="px-4 py-2 text-slate-700 font-bold">{s.waiterName || s.employeeName || '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{s.tableId || '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{branchName(s.branchId)}</td>
                  <td className="px-4 py-2 text-slate-600">{s.paymentMethod}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${s.status === 'Refunded' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {s.status === 'Refunded' ? 'Reembolsada' : 'Completada'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-black text-slate-800">{formatMXN(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comandas */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 text-slate-700 font-black text-xs uppercase">
          <ClipboardList className="w-4 h-4" /> Comandas (cuentas abiertas y cerradas)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
              <tr>
                <th className="text-left px-4 py-2">Mesa</th>
                <th className="text-left px-4 py-2">Mesero</th>
                <th className="text-left px-4 py-2">Sucursal</th>
                <th className="text-left px-4 py-2">Abierta</th>
                <th className="text-left px-4 py-2">Cerrada</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400 font-medium">Sin comandas para este filtro — aparecerán aquí en cuanto el flujo de mesas esté activo.</td></tr>
              ) : filteredOrders.map(o => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-700 font-bold">{o.tableId}</td>
                  <td className="px-4 py-2 text-slate-600">{o.waiterName}</td>
                  <td className="px-4 py-2 text-slate-600">{branchName(o.branchId)}</td>
                  <td className="px-4 py-2 text-slate-600">{o.openedAt}</td>
                  <td className="px-4 py-2 text-slate-600">{o.closedAt || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${o.status === 'open' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {o.status === 'open' ? 'Abierta' : 'Cerrada'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-black text-slate-800">{formatMXN(orderTotal(o, salesById))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Movimientos de caja */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 text-slate-700 font-black text-xs uppercase">
          <Wallet className="w-4 h-4" /> Movimientos de Caja
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
              <tr>
                <th className="text-left px-4 py-2">Hora</th>
                <th className="text-left px-4 py-2">Sucursal</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Descripción</th>
                <th className="text-right px-4 py-2">Monto</th>
              </tr>
            </thead>
            <tbody>
              {filteredCashMovements.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-slate-400 font-medium">Sin movimientos para este filtro.</td></tr>
              ) : filteredCashMovements.map((m, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-600">{m.time}</td>
                  <td className="px-4 py-2 text-slate-600">{branchName(m.branchId)}</td>
                  <td className="px-4 py-2 text-slate-600">{m.type}</td>
                  <td className="px-4 py-2 text-slate-600">{m.description}</td>
                  <td className={`px-4 py-2 text-right font-black ${m.type === 'Egreso' ? 'text-rose-600' : 'text-slate-800'}`}>
                    {m.type === 'Egreso' ? '-' : ''}{formatMXN(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
