import React, { useState, useMemo } from 'react';
import { 
  LogOut, 
  Building2, 
  MapPin, 
  Utensils, 
  Clock,
  CheckCircle,
  FolderOpen
} from 'lucide-react';
import TablesFloorView from './TablesFloorView';
import ComandaView from './ComandaView';
import { formatMXN } from '../lib/format';

interface Product {
  id: string;
  name: string;
  category: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  printDestination?: 'cocina' | 'barra' | 'ninguno';
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  unpaidBalance: number;
  registeredDate: string;
}

interface Branch {
  id: string;
  name: string;
  zones?: string[];
}

interface Table {
  id: string;
  name: string;
  branchId: string;
  capacity?: number;
  status: 'libre' | 'ocupada' | 'por_cobrar';
  currentOrderId?: string;
  shape?: 'round' | 'square';
  zone?: string;
  precuentaPrinted?: boolean;
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

interface WaiterShellProps {
  user: any;
  companyName: string;
  activeCompanyId: string;
  currentUserMember: any;
  products: Product[];
  branches: Branch[];
  tables: Table[];
  orders: Order[];
  customers: Customer[];
  selectedBranchId: string;
  branding: any;
  onLogout: () => void;
  buildAndCommitSale: (params: any) => any;
  onSaleComplete: (sale: any) => void;
  userAvailableCompanies?: any;
  onSwitchCompany?: (companyId: string) => void;
  onLeaveCompany?: () => void;
  printConfig?: any;
  onPrintReceipt?: (sale: any, options?: any) => void;
  onPrintPrecuenta?: (order: any, table: any, options?: any) => void;
}


export default function WaiterShell({
  user,
  companyName,
  activeCompanyId,
  currentUserMember,
  products,
  branches,
  tables,
  orders,
  customers,
  selectedBranchId,
  branding,
  onLogout,
  buildAndCommitSale,
  onSaleComplete,
  userAvailableCompanies = {},
  onSwitchCompany,
  onLeaveCompany,
  printConfig,
  onPrintReceipt,
  onPrintPrecuenta
}: WaiterShellProps) {
  const [activeTab, setActiveTab] = useState<'tables' | 'my-orders'>('tables');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [isManagingOrder, setIsManagingOrder] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState<'open' | 'closed'>('open');

  // Find active orders by table ID
  const activeOrdersMap = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach(o => {
      if (o.status === 'open' && o.branchId === selectedBranchId) {
        map.set(o.tableId, o);
      }
    });
    return map;
  }, [orders, selectedBranchId]);

  // Find current selected table's active order (can be open or closed if viewed from history)
  const currentActiveOrder = useMemo(() => {
    if (!selectedTable) return null;
    
    // First, look for an open order on the table
    const openOrder = activeOrdersMap.get(selectedTable.id);
    if (openOrder) return openOrder;

    // If no open order and we are managing the table, look for the order linked by currentOrderId
    if (selectedTable.currentOrderId) {
      return orders.find(o => o.id === selectedTable.currentOrderId) || null;
    }

    return null;
  }, [selectedTable, activeOrdersMap, orders]);

  // Waiter's own orders based on status filter
  const myFilteredOrders = useMemo(() => {
    return orders.filter(o => o.status === orderStatusFilter && o.waiterId === user.uid && o.branchId === selectedBranchId);
  }, [orders, orderStatusFilter, user.uid, selectedBranchId]);

  // Keep a count of open ones for the nav badge
  const myOpenOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === 'open' && o.waiterId === user.uid && o.branchId === selectedBranchId).length;
  }, [orders, user.uid, selectedBranchId]);

  const activeBranchName = branches.find(b => b.id === selectedBranchId)?.name || 'Sucursal Principal';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans select-none text-slate-800">
      
      {/* Premium Header */}
      <header 
        className="text-white shadow-md px-4 py-3 flex justify-between items-center z-15 border-b"
        style={{ 
          backgroundColor: 'var(--brand-dark, #0f172a)', 
          borderColor: 'color-mix(in srgb, var(--brand-primary, #6366f1) 30%, transparent)' 
        }}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <div 
            className="p-2 rounded-xl"
            style={{ 
              backgroundColor: 'color-mix(in srgb, var(--brand-dark, #0f172a) 55%, black)',
              border: '1px solid color-mix(in srgb, var(--brand-primary, #6366f1) 30%, transparent)' 
            }}
          >
            <Utensils className="w-5 h-5 text-amber-500 animate-pulse" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-base font-black tracking-wider truncate" style={{ color: 'var(--brand-primary, #6366f1)' }}>
              {companyName}
            </span>
            <span className="text-[10px] font-bold text-slate-300 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-amber-500 shrink-0" />
              {activeBranchName}
            </span>
          </div>
        </div>

        {/* User profile & controls */}
        <div className="flex items-center space-x-2">
          <div className="hidden sm:flex flex-col text-right mr-1">
            <span className="text-xs font-black text-white">{currentUserMember?.name || user.displayName || 'Mesero'}</span>
            <span className="text-[9px] text-amber-500 font-extrabold uppercase tracking-widest flex items-center gap-1"><Utensils className="w-2.5 h-2.5" />Mesero</span>
          </div>
          
          {/* Switch Company if multi-company */}
          {Object.keys(userAvailableCompanies).length > 1 && onLeaveCompany && (
            <button 
              onClick={onLeaveCompany}
              className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-350 hover:text-white border border-slate-700 rounded-xl cursor-pointer transition shadow-sm"
              title="Cambiar de Comercio"
            >
              <Building2 className="w-4 h-4" />
            </button>
          )}

          {/* Logout */}
          <button 
            onClick={onLogout}
            className="p-2 bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-305 border border-red-900/50 rounded-xl cursor-pointer transition shadow-sm"
            title="Cerrar Sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Navigation Sub-header */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex space-x-1.5 w-full max-w-md">
          <button
            onClick={() => { 
              setActiveTab('tables'); 
              setSelectedTable(null); 
              setIsManagingOrder(false); 
            }}
            className={`flex-1 py-2 px-3 text-xs font-black uppercase rounded-xl transition cursor-pointer text-center flex items-center justify-center gap-1.5 border ${
              activeTab === 'tables' 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-black' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Utensils className="w-4 h-4" />
            <span>Mapa de Mesas</span>
          </button>
          <button
            onClick={() => { 
              setActiveTab('my-orders'); 
              setSelectedTable(null); 
              setIsManagingOrder(false); 
            }}
            className={`flex-1 py-2 px-3 text-xs font-black uppercase rounded-xl transition cursor-pointer text-center flex items-center justify-center gap-1.5 border relative ${
              activeTab === 'my-orders' 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-755 font-black' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Mis Comandas</span>
            {myOpenOrdersCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-rose-500 border border-white text-white font-black text-[9px] w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                {myOpenOrdersCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <main className="flex-grow overflow-hidden relative">
        
        {/* VIEW 1: MAPA DE MESAS */}
        {activeTab === 'tables' && (
          isManagingOrder && selectedTable ? (
            <ComandaView
              table={selectedTable}
              order={currentActiveOrder}
              products={products}
              customers={customers}
              activeCompanyId={activeCompanyId}
              selectedBranchId={selectedBranchId}
              currentUserMember={currentUserMember}
              user={user}
              buildAndCommitSale={buildAndCommitSale}
              onClose={() => {
                setSelectedTable(null);
                setIsManagingOrder(false);
              }}
              onSaleComplete={onSaleComplete}
              printConfig={printConfig}
              onPrintReceipt={onPrintReceipt}
              onPrintPrecuenta={onPrintPrecuenta}
            />
          ) : (
            <TablesFloorView
              tables={tables}
              orders={orders}
              selectedBranchId={selectedBranchId}
              activeBranchName={activeBranchName}
              activeCompanyId={activeCompanyId}
              currentUserMember={currentUserMember}
              user={user}
              onManageOrder={(table) => {
                setSelectedTable(table);
                setIsManagingOrder(true);
              }}
              branchZones={branches.find(b => b.id === selectedBranchId)?.zones || ['Principal', 'Terraza', 'Bar/VIP']}
            />
          )
        )}

        {/* VIEW 2: MIS COMANDAS */}
        {activeTab === 'my-orders' && (
          <div className="p-6 bg-slate-50 min-h-full flex flex-col space-y-6 overflow-y-auto max-h-[calc(100vh-140px)]">
            
            {/* Header & Filter Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-5">
              <div>
                <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[var(--brand-primary,#6366f1)]" />
                  <span>Mis Comandas Abiertas / Cerradas</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Historial de las órdenes en el salón asignadas a ti.
                </p>
              </div>

              {/* Status Filters */}
              <div className="flex bg-white border border-slate-200 p-1 rounded-xl shadow-sm space-x-1 shrink-0">
                <button
                  onClick={() => setOrderStatusFilter('open')}
                  className={`px-3 py-1.5 text-xs font-extrabold rounded-lg cursor-pointer transition select-none flex items-center gap-1 ${
                    orderStatusFilter === 'open'
                      ? 'bg-indigo-650 text-white shadow-sm'
                      : 'text-slate-550 hover:bg-slate-50'
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Abiertas</span>
                </button>
                <button
                  onClick={() => setOrderStatusFilter('closed')}
                  className={`px-3 py-1.5 text-xs font-extrabold rounded-lg cursor-pointer transition select-none flex items-center gap-1 ${
                    orderStatusFilter === 'closed'
                      ? 'bg-indigo-650 text-white shadow-sm'
                      : 'text-slate-550 hover:bg-slate-50'
                  }`}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Cerradas</span>
                </button>
              </div>
            </div>

            {/* List Grid */}
            {myFilteredOrders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center max-w-md mx-auto my-12 shadow-sm">
                <Clock className="w-12 h-12 text-slate-350 mx-auto mb-3" />
                <h3 className="font-extrabold text-sm text-slate-700">
                  Sin comandas {orderStatusFilter === 'open' ? 'abiertas' : 'cerradas'}
                </h3>
                <p className="text-xs text-slate-550 mt-1 max-w-xs mx-auto">
                  {orderStatusFilter === 'open' 
                    ? 'No tienes comandas activas en este momento. Ve al Mapa de Mesas para tomar una orden.'
                    : 'No tienes comandas registradas como cerradas/cobradas en este periodo.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {myFilteredOrders.map(order => {
                  const table = tables.find(t => t.id === order.tableId);
                  const total = order.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
                  const openedDate = new Date(order.openedAt);
                  const timeStr = openedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <button
                      key={order.id}
                      onClick={() => {
                        if (table) {
                          // Setup selected table and route waiter straight to details
                          setSelectedTable({
                            ...table,
                            currentOrderId: order.id
                          });
                          setIsManagingOrder(true);
                          setActiveTab('tables');
                        } else {
                          // Handle order if table has been deleted, by using a virtual table
                          const virtualTable: Table = {
                            id: order.tableId,
                            name: `Mesa ID: ${order.tableId.slice(-4)}`,
                            branchId: selectedBranchId,
                            status: order.status === 'open' ? 'ocupada' : 'libre',
                            currentOrderId: order.id
                          };
                          setSelectedTable(virtualTable);
                          setIsManagingOrder(true);
                          setActiveTab('tables');
                        }
                      }}
                      className="bg-white border border-slate-200 hover:border-indigo-400 p-5 rounded-2xl text-left flex flex-col justify-between transition cursor-pointer hover:shadow-md hover:scale-[1.005] h-48 shadow-sm"
                    >
                      <div className="w-full">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-black text-base text-slate-800">
                              {table?.name || `Mesa ID: ${order.tableId.slice(-4)}`}
                            </span>
                            <p className="text-[9px] text-slate-400 font-extrabold uppercase mt-0.5 tracking-wider">
                              ID: {order.id.slice(-6).toUpperCase()}
                            </p>
                          </div>
                          <span className={`text-[9px] font-black uppercase py-0.5 px-2 rounded-full border ${
                            orderStatusFilter === 'open'
                              ? 'bg-indigo-50 border-indigo-250 text-indigo-800'
                              : 'bg-emerald-50 border-emerald-250 text-emerald-800'
                          }`}>
                            <Clock className="w-3 h-3 inline mr-0.5" />{timeStr}
                          </span>
                        </div>

                        {/* Items list preview */}
                        <div className="mt-3 space-y-1 max-h-16 overflow-hidden">
                          {order.items.slice(0, 3).map((it, idx) => (
                            <p key={idx} className="text-[10px] text-slate-550 truncate font-semibold">
                              • {it.quantity}x {it.name}
                            </p>
                          ))}
                          {order.items.length > 3 && (
                            <p className="text-[9px] text-slate-450 font-bold pl-2">
                              + {order.items.length - 3} artículos más...
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-3 border-t border-slate-100 mt-3 w-full shrink-0">
                        <span className="text-xs font-bold text-slate-400">Total:</span>
                        <span className="text-sm font-black text-indigo-650">{formatMXN(total)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
