import React, { useState, useMemo } from 'react';
import {
  Users,
  Coffee,
  Clock,
  User,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Plus,
  Settings,
  X,
  Check,
  Trash2,
  Utensils,
  FolderOpen,
  Printer
} from 'lucide-react';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { formatMXN } from '../lib/format';

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

interface TablesFloorViewProps {
  tables: Table[];
  orders: Order[];
  selectedBranchId: string;
  activeBranchName: string;
  activeCompanyId: string;
  currentUserMember: any;
  user: any;
  onManageOrder: (table: Table) => void;
  branchZones: string[];
  onPrintPrecuenta?: (orderData: any, tableData: any, callbacks?: any) => void;
}


export default function TablesFloorView({
  tables,
  orders,
  selectedBranchId,
  activeBranchName,
  activeCompanyId,
  currentUserMember,
  user,
  onManageOrder,
  branchZones,
  onPrintPrecuenta
}: TablesFloorViewProps) {
  const [selectedZone, setSelectedZone] = useState<string>('Todas');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'libre' | 'ocupada' | 'por_cobrar'>('All');
  const [activeTable, setActiveTable] = useState<Table | null>(null);

  // States for Add Table Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState(4);
  const [newTableZone, setNewTableZone] = useState<string>(branchZones[0] || '');

  // States for Edit Zones Modal
  const [isZonesModalOpen, setIsZonesModalOpen] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [editingZoneIndex, setEditingZoneIndex] = useState<number | null>(null);
  const [editingZoneValue, setEditingZoneValue] = useState('');
  const [newTableShape, setNewTableShape] = useState<'square' | 'round'>('square');

  // State for Custom Confirm Modal
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm
    });
  };

  const [isPrintingPrecuenta, setIsPrintingPrecuenta] = useState(false);

  const handlePrintPrecuentaDirect = async (tableToPrint: Table) => {
    const orderToPrint = activeOrdersMap.get(tableToPrint.id);
    if (!orderToPrint || !activeCompanyId) return;

    const sentItems = orderToPrint.items.filter(it => !!it.sentAt);
    if (sentItems.length === 0) return;

    setIsPrintingPrecuenta(true);
    try {
      if (onPrintPrecuenta) {
        onPrintPrecuenta(
          {
            id: orderToPrint.id,
            waiterName: orderToPrint.waiterName,
            openedAt: orderToPrint.openedAt,
            items: sentItems.map(it => ({ name: it.name, quantity: it.quantity, unitPrice: it.unitPrice }))
          },
          { name: tableToPrint.name },
          {
            onSuccess: async () => {
              await updateDoc(doc(db, 'companies', activeCompanyId, 'tables', tableToPrint.id), {
                precuentaPrinted: true
              });
              setActiveTable(prev => prev ? { ...prev, precuentaPrinted: true } : null);
            },
            onError: (msg) => {
              console.error("Error direct printing pre-cuenta:", msg);
            }
          }
        );
      } else {
        await updateDoc(doc(db, 'companies', activeCompanyId, 'tables', tableToPrint.id), {
          precuentaPrinted: true
        });
        setActiveTable(prev => prev ? { ...prev, precuentaPrinted: true } : null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsPrintingPrecuenta(false);
    }
  };

  // Filter tables by branch
  const branchTables = useMemo(() => {
    return tables.filter(t => t.branchId === selectedBranchId);
  }, [tables, selectedBranchId]);

  // Map active orders by table ID
  const activeOrdersMap = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach(o => {
      if (o.status === 'open' && o.branchId === selectedBranchId) {
        map.set(o.tableId, o);
      }
    });
    return map;
  }, [orders, selectedBranchId]);

  // Find current selected table's active order
  const selectedTableOrder = useMemo(() => {
    if (!activeTable) return null;
    return activeOrdersMap.get(activeTable.id) || null;
  }, [activeTable, activeOrdersMap]);

  // Filter logic for grid
  const filteredTables = useMemo(() => {
    return branchTables.filter(t => {
      // Determine zone (default to 'Principal' if missing)
      const tableZone = t.zone || 'Principal';
      const matchesZone = selectedZone === 'Todas' || tableZone === selectedZone;
      const matchesStatus = selectedStatus === 'All' || t.status === selectedStatus;
      return matchesZone && matchesStatus;
    });
  }, [branchTables, selectedZone, selectedStatus]);

  // Calculate statistics
  const totalTables = branchTables.length;
  const availableCount = branchTables.filter(t => t.status === 'libre').length;
  const occupiedCount = branchTables.filter(t => t.status === 'ocupada').length;
  const reservedCount = branchTables.filter(t => t.status === 'por_cobrar').length;

  // Open Table / Create Order directly
  const handleOpenTable = async (tableToOpen: Table) => {
    if (!activeCompanyId) return;
    const orderId = 'ord_' + Math.floor(Math.random() * 900000 + 100000);
    const newOrder: Order = {
      id: orderId,
      tableId: tableToOpen.id,
      branchId: selectedBranchId,
      status: 'open',
      waiterId: user.uid,
      waiterName: currentUserMember?.name || 'Mesero',
      openedAt: new Date().toISOString(),
      items: []
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'companies', activeCompanyId, 'orders', orderId), newOrder);
      batch.update(doc(db, 'companies', activeCompanyId, 'tables', tableToOpen.id), {
        status: 'ocupada',
        currentOrderId: orderId
      });
      await batch.commit();

      const updatedTable: Table = {
        ...tableToOpen,
        status: 'ocupada',
        currentOrderId: orderId
      };
      setActiveTable(updatedTable);
      onManageOrder(updatedTable);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/orders/${orderId}`);
    }
  };

  // Release table without charge
  const handleReleaseTable = async (tableToRelease: Table) => {
    if (!activeCompanyId) return;
    const orderToClose = activeOrdersMap.get(tableToRelease.id);

    showConfirm(
      '¿Liberar Mesa sin Cobro?',
      `¿Estás seguro de liberar la ${tableToRelease.name}? Se cerrará la comanda activa de forma permanente sin registrar ningún cobro en caja.`,
      async () => {
        try {
          const batch = writeBatch(db);
          if (orderToClose) {
            batch.update(doc(db, 'companies', activeCompanyId, 'orders', orderToClose.id), {
              status: 'closed',
              closedAt: new Date().toISOString()
            });
          }
          batch.update(doc(db, 'companies', activeCompanyId, 'tables', tableToRelease.id), {
            status: 'libre',
            currentOrderId: null
          });
          await batch.commit();
          setActiveTable(null);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/tables/${tableToRelease.id}`);
        }
      }
    );
  };

  // Add table submit handler
  const handleSubmitAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompanyId) return;
    if (!newTableName.trim()) return;

    const tableId = 'tab_' + Math.floor(Math.random() * 900000 + 100000);
    const newTable: Table = {
      id: tableId,
      name: newTableName.trim(),
      branchId: selectedBranchId,
      capacity: newTableCapacity,
      status: 'libre',
      shape: newTableShape,
      zone: newTableZone
    };

    try {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'companies', activeCompanyId, 'tables', tableId), newTable);
      
      setNewTableName('');
      setNewTableCapacity(4);
      setNewTableZone(branchZones[0] || '');
      setNewTableShape('square');
      setIsAddModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/tables/${tableId}`);
    }
  };

  // Delete table handler
  const handleDeleteTable = async (tableToDelete: Table) => {
    if (!activeCompanyId) return;
    if (tableToDelete.status !== 'libre') {
      alert('Solo se pueden eliminar mesas que estén en estado Libre.');
      return;
    }

    showConfirm(
      '¿Eliminar Mesa?',
      `¿Estás seguro de eliminar permanentemente la ${tableToDelete.name}? Esta acción no se puede deshacer y borrará la mesa del salón de forma definitiva.`,
      async () => {
        try {
          const { deleteDoc } = await import('firebase/firestore');
          await deleteDoc(doc(db, 'companies', activeCompanyId, 'tables', tableToDelete.id));
          setActiveTable(null);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/tables/${tableToDelete.id}`);
        }
      }
    );
  };

  // Zone management: zones are per-branch (branchZones prop), stored as a plain string[] on
  // the Branch doc — not every restaurant has the same salon layout, so this replaced the
  // fixed 'Principal'/'Terraza'/'Bar/VIP' list.
  const handleAddZone = async () => {
    const clean = newZoneName.trim();
    if (!clean) return;
    if (branchZones.includes(clean)) {
      alert(`La zona "${clean}" ya existe.`);
      return;
    }
    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'branches', selectedBranchId), {
        zones: [...branchZones, clean]
      });
      setNewZoneName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/branches/${selectedBranchId}`);
    }
  };

  const handleRenameZone = async (index: number) => {
    const oldName = branchZones[index];
    const cleanNew = editingZoneValue.trim();
    if (!cleanNew || cleanNew === oldName) {
      setEditingZoneIndex(null);
      return;
    }
    if (branchZones.includes(cleanNew)) {
      alert(`La zona "${cleanNew}" ya existe.`);
      return;
    }
    try {
      const updatedZones = branchZones.map((z, i) => i === index ? cleanNew : z);
      const batch = writeBatch(db);
      batch.update(doc(db, 'companies', activeCompanyId, 'branches', selectedBranchId), { zones: updatedZones });
      // Re-point any table already sitting in the renamed zone so it doesn't go orphaned.
      branchTables.filter(t => (t.zone || branchZones[0]) === oldName).forEach(t => {
        batch.update(doc(db, 'companies', activeCompanyId, 'tables', t.id), { zone: cleanNew });
      });
      await batch.commit();
      setEditingZoneIndex(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/branches/${selectedBranchId}`);
    }
  };

  const handleDeleteZone = async (index: number) => {
    const zoneName = branchZones[index];
    const tablesInZone = branchTables.filter(t => (t.zone || branchZones[0]) === zoneName);
    if (tablesInZone.length > 0) {
      alert(`No se puede eliminar "${zoneName}": ${tablesInZone.length} mesa(s) siguen asignadas a esa zona. Reasígnalas primero.`);
      return;
    }
    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'branches', selectedBranchId), {
        zones: branchZones.filter((_, i) => i !== index)
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/branches/${selectedBranchId}`);
    }
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen text-slate-800 flex flex-col space-y-6">

      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Coffee className="w-6 h-6 text-[var(--brand-primary,#6366f1)]" />
            <span>Plano de Mesas y Salón</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Visualiza y gestiona las comandas, estados y distribución táctil de las mesas para <strong className="text-[var(--brand-primary,#6366f1)]">{activeBranchName}</strong>.
          </p>
        </div>

        {/* Action button — creating tables is salon management, reserved for owner/admin */}
        {(currentUserMember?.role === 'owner' || currentUserMember?.role === 'admin') && (
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2.5 bg-[var(--brand-primary,#6366f1)] hover:bg-[color-mix(in_srgb,var(--brand-primary,#6366f1)_90%,black)] text-white font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer transition select-none active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Agregar Mesa</span>
          </button>
        )}
      </div>

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase font-black tracking-wider text-slate-400">Total Mesas</p>
            <h4 className="text-xl font-black mt-1">{totalTables}</h4>
          </div>
          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center font-bold text-slate-500 text-sm">
            <Coffee className="w-4 h-4" />
          </div>
        </div>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'libre' ? 'All' : 'libre')}
          className={`bg-white border rounded-2xl p-4 shadow-sm flex items-center justify-between cursor-pointer text-left transition select-none hover:shadow-md ${
            selectedStatus === 'libre' ? 'border-[var(--brand-primary,#6366f1)] ring-1 ring-[var(--brand-primary,#6366f1)]' : 'border-slate-200'
          }`}
        >
          <div>
            <p className="text-[10px] uppercase font-black tracking-wider text-emerald-500">Disponibles</p>
            <h4 className="text-xl font-black mt-1 text-emerald-600">{availableCount}</h4>
          </div>
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </button>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'ocupada' ? 'All' : 'ocupada')}
          className={`bg-white border rounded-2xl p-4 shadow-sm flex items-center justify-between cursor-pointer text-left transition select-none hover:shadow-md ${
            selectedStatus === 'ocupada' ? 'border-[var(--brand-primary,#6366f1)] ring-1 ring-[var(--brand-primary,#6366f1)]' : 'border-slate-200'
          }`}
        >
          <div>
            <p className="text-[10px] uppercase font-black tracking-wider text-rose-500">Ocupadas</p>
            <h4 className="text-xl font-black mt-1 text-rose-600">{occupiedCount}</h4>
          </div>
          <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
            <Coffee className="w-5 h-5" />
          </div>
        </button>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'por_cobrar' ? 'All' : 'por_cobrar')}
          className={`bg-white border rounded-2xl p-4 shadow-sm flex items-center justify-between cursor-pointer text-left transition select-none hover:shadow-md ${
            selectedStatus === 'por_cobrar' ? 'border-[var(--brand-primary,#6366f1)] ring-1 ring-[var(--brand-primary,#6366f1)]' : 'border-slate-200'
          }`}
        >
          <div>
            <p className="text-[10px] uppercase font-black tracking-wider text-amber-500">Por Cobrar</p>
            <h4 className="text-xl font-black mt-1 text-amber-600">{reservedCount}</h4>
          </div>
          <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </button>
      </div>

      {/* Navigation Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 p-3 rounded-2xl shadow-sm">
        <div className="flex items-center space-x-1.5 overflow-x-auto max-w-full">
          {['Todas', ...branchZones].map(zone => (
            <button
              key={zone}
              onClick={() => setSelectedZone(zone)}
              className={`px-4 py-2 text-xs font-black rounded-xl transition cursor-pointer select-none border ${
                selectedZone === zone
                  ? 'bg-[var(--brand-primary,#6366f1)] border-[var(--brand-primary,#6366f1)] text-white shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {zone}
            </button>
          ))}
          {(currentUserMember?.role === 'owner' || currentUserMember?.role === 'admin') && (
            <button
              onClick={() => setIsZonesModalOpen(true)}
              title="Editar zonas del salón"
              className="p-2 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:text-[var(--brand-primary,#6366f1)] hover:border-[var(--brand-primary,#6366f1)] transition cursor-pointer shrink-0"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Legend Indicator */}
        <div className="flex flex-wrap gap-4 text-[10px] font-black uppercase text-slate-500 tracking-wider">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Libre</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span>Ocupada</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Por Cobrar</span>
          </div>
        </div>
      </div>

      {/* Main Floor Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Tables Floor Area */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm min-h-[500px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-extrabold text-sm text-slate-500 uppercase tracking-wider">
              Distribución: {selectedZone}
            </h3>
            <span className="text-xs bg-slate-100 px-3 py-1 rounded-full font-bold text-slate-500">
              Mostrando {filteredTables.length} mesas
            </span>
          </div>

          {filteredTables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <p className="text-slate-400 font-bold text-sm">No hay mesas con los filtros activos.</p>
              <button 
                onClick={() => { setSelectedZone('Todas'); setSelectedStatus('All'); }}
                className="text-xs text-[var(--brand-primary,#6366f1)] hover:underline font-extrabold"
              >
                Limpiar Filtros
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
              {filteredTables.map(table => {
                const isSelected = activeTable?.id === table.id;
                const tableOrder = activeOrdersMap.get(table.id);
                const orderTotal = tableOrder
                  ? tableOrder.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
                  : 0;

                // Color variations based on status
                let statusClasses = '';
                let statusColor = '';
                if (table.status === 'libre') {
                  statusClasses = 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-400 hover:bg-emerald-50 text-emerald-800';
                  statusColor = 'var(--color-emerald-500)';
                } else if (table.status === 'ocupada') {
                  statusClasses = 'border-rose-200 bg-rose-50/50 hover:border-rose-400 hover:bg-rose-50 text-rose-800';
                  statusColor = 'var(--color-rose-500)';
                } else if (table.status === 'por_cobrar') {
                  statusClasses = 'border-amber-200 bg-amber-50/50 hover:border-amber-400 hover:bg-amber-50 text-amber-800';
                  statusColor = 'var(--color-amber-500)';
                }

                // Determine shape
                const shape = table.shape || 'square';
                // Determine zone
                const zone = table.zone || 'Principal';

                return (
                  <button
                    key={table.id}
                    onClick={() => setActiveTable(table)}
                    className={`h-40 rounded-3xl border-2 flex flex-col justify-between p-4.5 cursor-pointer text-left transition duration-200 relative select-none hover:shadow-md active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary,#6366f1)] focus:ring-offset-2 ${statusClasses} ${
                      isSelected ? 'border-[var(--brand-primary,#6366f1)] hover:border-[var(--brand-primary,#6366f1)] ring-2 ring-[var(--brand-primary,#6366f1)]' : ''
                    }`}
                  >
                    {/* Top Row: Mesa ID / Zone Badge */}
                    <div className="flex justify-between items-center w-full">
                      <span className="text-[9px] bg-white border border-slate-100 px-2 py-0.5 rounded-lg text-slate-500 font-extrabold shadow-sm">
                        {zone}
                      </span>
                      <div className="flex items-center gap-1">
                        {table.status === 'por_cobrar' && table.precuentaPrinted === false && (
                          <Printer className="w-3.5 h-3.5 text-amber-500 animate-bounce" title="Pre-cuenta pendiente de imprimir" />
                        )}
                        <span 
                          className={`w-2.5 h-2.5 rounded-full ${
                            table.status === 'ocupada' || (table.status === 'por_cobrar' && table.precuentaPrinted === false) ? 'animate-pulse' : ''
                          }`}
                          style={{ backgroundColor: statusColor }}
                        />
                      </div>
                    </div>

                    {/* Middle: Visual representation of Table Shape */}
                    <div className="flex justify-center items-center my-1.5 flex-1 relative">
                      <div 
                        className={`w-16 h-16 flex flex-col items-center justify-center shadow-inner relative transition duration-300 ${
                          shape === 'round' ? 'rounded-full' : 'rounded-2xl'
                        } ${
                          table.status === 'ocupada' 
                            ? 'bg-rose-100' 
                            : table.status === 'por_cobrar'
                            ? 'bg-amber-100'
                            : 'bg-emerald-100'
                        }`}
                      >
                        <span className="text-base font-black">{table.name}</span>
                        {/* Capacity visual dots */}
                        <div className="absolute -top-1 px-1 bg-white rounded-full border border-slate-150 text-[8px] font-black text-slate-500 flex items-center gap-0.5 shadow-sm">
                          <Users className="w-2 h-2" />
                          <span>{table.capacity || 4}</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Detail/Total */}
                    <div className="w-full flex justify-between items-end">
                      {table.status !== 'libre' && tableOrder ? (
                        <>
                          <div className="leading-none">
                            <p className="text-[8px] uppercase font-black text-slate-400">Total</p>
                            <p className="text-xs font-black text-slate-850">
                              {formatMXN(orderTotal)}
                            </p>
                          </div>
                          <div className="flex items-center gap-0.5 text-slate-400 text-[9px] font-bold">
                            <Clock className="w-2.5 h-2.5" />
                            <span>{Math.floor((Date.now() - Date.parse(tableOrder.openedAt)) / 60000)}m</span>
                          </div>
                        </>
                      ) : (
                        <span className="text-[9px] font-extrabold text-emerald-600 uppercase tracking-wide">
                          Disponible
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Table Drawer/Details Sidepanel */}
        <div className="lg:col-span-4 flex flex-col space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm min-h-[500px] flex flex-col justify-between">
            {activeTable ? (
              <div className="flex-1 flex flex-col justify-between">
                
                {/* Upper Details block */}
                <div className="space-y-5">
                  <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                    <div>
                      <h4 className="text-base font-black tracking-tight flex items-center gap-1.5">
                        <span>{activeTable.name}</span>
                        <span className="text-[10px] font-extrabold px-2 py-0.5 bg-slate-100 rounded-lg text-slate-500">
                          {activeTable.zone || 'Principal'}
                        </span>
                      </h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Detalle Operativo</p>
                    </div>
                    <button
                      onClick={() => setActiveTable(null)}
                      aria-label="Cerrar"
                      className="text-slate-400 hover:text-slate-600 font-extrabold text-sm"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Status Indicator Panel */}
                  <div 
                    className="p-3.5 rounded-2xl flex items-center gap-3 border shadow-inner"
                    style={{
                      backgroundColor: activeTable.status === 'ocupada' 
                        ? 'color-mix(in srgb, var(--brand-accent, #a855f7) 6%, white)'
                        : activeTable.status === 'por_cobrar'
                        ? 'bg-amber-50/50'
                        : 'color-mix(in srgb, var(--brand-primary, #6366f1) 6%, white)',
                      borderColor: activeTable.status === 'ocupada'
                        ? 'color-mix(in srgb, var(--brand-accent, #a855f7) 12%, transparent)'
                        : activeTable.status === 'por_cobrar'
                        ? 'var(--color-amber-100)'
                        : 'color-mix(in srgb, var(--brand-primary, #6366f1) 12%, transparent)'
                    }}
                  >
                    <span className="text-2xl">
                      {activeTable.status === 'ocupada' ? <Utensils className="w-6 h-6" /> : activeTable.status === 'por_cobrar' ? <DollarSign className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
                    </span>
                    <div>
                      <h5 className="text-xs font-black uppercase tracking-wide">
                        {activeTable.status === 'ocupada' ? 'Mesa Ocupada' : activeTable.status === 'por_cobrar' ? 'Por Cobrar' : 'Disponible / Libre'}
                      </h5>
                      <p className="text-[10px] text-slate-500">
                        Capacidad de comensales: {activeTable.capacity || 4} personas
                      </p>
                    </div>
                  </div>

                  {/* Table details lists */}
                  <div className="space-y-3.5">
                    {selectedTableOrder && (
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-150 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-[var(--brand-primary,#6366f1)]/10 text-[var(--brand-primary,#6366f1)] flex items-center justify-center">
                          <User className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[8px] font-black uppercase text-slate-400 block tracking-wider">Mesero Asignado</span>
                          <span className="text-xs font-extrabold text-slate-700">
                            {selectedTableOrder.waiterName}
                          </span>
                        </div>
                      </div>
                    )}

                    {activeTable.status !== 'libre' && selectedTableOrder && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-150">
                          <span className="text-[8px] font-black uppercase text-slate-400 block tracking-wider">Monto Cuenta</span>
                          <span className="text-sm font-black text-rose-600 mt-0.5 block">
                            {formatMXN(selectedTableOrder.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0))}
                          </span>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-150">
                          <span className="text-[8px] font-black uppercase text-slate-400 block tracking-wider">Tiempo Transcurrido</span>
                          <span className="text-sm font-bold text-slate-700 mt-0.5 block flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 inline text-slate-400" />
                            {Math.floor((Date.now() - Date.parse(selectedTableOrder.openedAt)) / 60000)} min
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Real Active items in current order */}
                  {activeTable.status !== 'libre' && selectedTableOrder && selectedTableOrder.items.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider">Artículos Consumidos</span>
                      <div className="border border-slate-150 rounded-2xl overflow-hidden divide-y divide-slate-100 text-xs max-h-[160px] overflow-y-auto">
                        {selectedTableOrder.items.map((item, idx) => (
                          <div key={idx} className="p-2.5 flex justify-between bg-slate-50/50">
                            <span className="font-semibold text-slate-700">
                              {item.quantity}x {item.name}
                            </span>
                            <span className="font-extrabold text-slate-850">
                              {formatMXN(item.unitPrice * item.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Action buttons */}
                <div className="space-y-2.5 pt-5 border-t border-slate-100 mt-5">
                  {currentUserMember?.role === 'employee' ? (
                    // Cajero (employee) specific actions
                    activeTable.status === 'por_cobrar' ? (
                      <div className="flex flex-col gap-2">
                        {activeTable.precuentaPrinted === false && (
                          <button
                            type="button"
                            onClick={() => handlePrintPrecuentaDirect(activeTable)}
                            disabled={isPrintingPrecuenta}
                            className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:scale-98 text-white font-extrabold text-xs rounded-xl shadow transition cursor-pointer text-center uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            {isPrintingPrecuenta ? 'Imprimiendo...' : 'Imprimir Pre-cuenta'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onManageOrder(activeTable)}
                          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-extrabold text-xs rounded-xl shadow transition cursor-pointer text-center uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />Cobrar Cuenta
                        </button>
                      </div>
                    ) : activeTable.status === 'ocupada' ? (
                      <div className="p-3 bg-rose-50/40 dark:bg-rose-950/10 rounded-xl text-center border border-rose-100 dark:border-rose-900/30">
                        <p className="text-xs font-bold text-rose-700 dark:text-rose-400">
                          Mesa en consumo. Esperando a que el mesero solicite la cuenta.
                        </p>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-center border border-slate-200 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                          Mesa disponible. Apertura exclusiva para Meseros.
                        </p>
                      </div>
                    )
                  ) : (
                    // Regular actions for Owner, Admin, Waiter
                    activeTable.status === 'libre' ? (
                      <button
                        type="button"
                        onClick={() => handleOpenTable(activeTable)}
                        className="w-full py-3 bg-[var(--brand-primary,#6366f1)] hover:bg-[color-mix(in_srgb,var(--brand-primary,#6366f1)_90%,black)] active:scale-98 text-white font-extrabold text-xs rounded-xl shadow transition cursor-pointer text-center uppercase tracking-wider"
                      >
                        Apertura de Mesa
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => onManageOrder(activeTable)}
                          className="w-full py-3 bg-slate-800 hover:bg-black text-white font-extrabold text-xs rounded-xl transition cursor-pointer text-center uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />Gestionar Comanda / Cobrar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextStatus = activeTable.status === 'ocupada' ? 'por_cobrar' : 'ocupada';
                            updateDoc(doc(db, 'companies', activeCompanyId, 'tables', activeTable.id), {
                              status: nextStatus
                            }).then(() => {
                              setActiveTable(prev => prev ? { ...prev, status: nextStatus } : null);
                            }).catch(err => {
                              handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/tables/${activeTable.id}`);
                            });
                          }}
                          className={`w-full py-2 border rounded-xl text-xs font-black text-center transition cursor-pointer uppercase tracking-wider ${
                            activeTable.status === 'ocupada'
                              ? 'border-amber-300 bg-amber-50/30 text-amber-700 hover:bg-amber-50'
                              : 'border-rose-300 bg-rose-50/30 text-rose-700 hover:bg-rose-50'
                          }`}
                        >
                          {activeTable.status === 'ocupada' ? 'Marcar Por Cobrar' : 'Regresar a Ocupada'}
                        </button>
                      </div>
                    )
                  )}

                  {activeTable.status !== 'libre' && currentUserMember?.role !== 'mesero' && currentUserMember?.role !== 'employee' && (
                    <button
                      type="button"
                      onClick={() => handleReleaseTable(activeTable)}
                      className="w-full py-2 bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 font-extrabold text-[10px] uppercase rounded-xl transition cursor-pointer text-center tracking-wide"
                    >
                      Liberar sin Cobro / Cancelar
                    </button>
                  )}

                  {activeTable.status === 'libre' && currentUserMember?.role !== 'mesero' && currentUserMember?.role !== 'employee' && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTable(activeTable)}
                      className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 font-extrabold text-[10px] uppercase rounded-xl transition cursor-pointer text-center tracking-wide border border-red-200 flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3 h-3" />Eliminar Mesa del Salón
                    </button>
                  )}
                </div>

              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 py-10">
                <HelpCircle className="w-10 h-10 mb-2 stroke-1" />
                <h5 className="font-extrabold text-xs uppercase tracking-wider text-slate-500">Mesa no seleccionada</h5>
                <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] mx-auto leading-relaxed">
                  Toca cualquier mesa del plano para gestionar comanda, tiempo, mesero asignado o realizar cobros rápidos.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Premium Add Table Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-slate-800">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                <Utensils className="w-4 h-4" /><span>Crear Nueva Mesa</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Cerrar"
                className="text-slate-400 hover:text-slate-600 font-extrabold text-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitAddTable} className="space-y-4 pt-4">
              {/* Name */}
              <div className="space-y-1 text-left">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Nombre / Identificador</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Mesa 12, Barra 2"
                  value={newTableName}
                  onChange={e => setNewTableName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl p-3 outline-none font-bold focus:ring-2 focus:ring-[var(--brand-primary,#6366f1)] text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Capacity */}
                <div className="space-y-1 text-left">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Capacidad</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    required
                    value={newTableCapacity}
                    onChange={e => setNewTableCapacity(parseInt(e.target.value) || 4)}
                    className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl p-3 outline-none font-bold focus:ring-2 focus:ring-[var(--brand-primary,#6366f1)] text-slate-800"
                  />
                </div>

                {/* Shape */}
                <div className="space-y-1 text-left">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Forma</label>
                  <select
                    value={newTableShape}
                    onChange={e => setNewTableShape(e.target.value as 'square' | 'round')}
                    className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl p-3 outline-none font-bold focus:ring-2 focus:ring-[var(--brand-primary,#6366f1)] text-slate-800 cursor-pointer"
                  >
                    <option value="square">Cuadrada</option>
                    <option value="round">Redonda</option>
                  </select>
                </div>
              </div>

              {/* Zone */}
              <div className="space-y-1 text-left">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider block">Zona del Salón</label>
                <select
                  value={newTableZone}
                  onChange={e => setNewTableZone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-xs rounded-xl p-3 outline-none font-bold focus:ring-2 focus:ring-[var(--brand-primary,#6366f1)] text-slate-800 cursor-pointer"
                >
                  {branchZones.length === 0 && <option value="">Sin zonas configuradas</option>}
                  {branchZones.map(zone => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-650 hover:bg-slate-50 text-xs font-black rounded-xl uppercase tracking-wider transition cursor-pointer text-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-[var(--brand-primary,#6366f1)] hover:bg-[color-mix(in_srgb,var(--brand-primary,#6366f1)_90%,black)] text-white text-xs font-black rounded-xl uppercase tracking-wider shadow-md transition cursor-pointer text-center active:scale-95"
                >
                  Guardar Mesa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Premium Confirm Dialog Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-slate-800">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto border border-rose-100 text-xl font-bold">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">
                  {confirmModal.title}
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed font-semibold">
                  {confirmModal.message}
                </p>
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-black rounded-xl uppercase tracking-wider transition cursor-pointer text-center"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl uppercase tracking-wider shadow-md transition cursor-pointer text-center active:scale-95"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Zones Modal — zones are per-branch, not a fixed list */}
      {isZonesModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-sm shadow-2xl text-slate-800">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-black uppercase tracking-wide">Zonas del Salón</h3>
              <button
                type="button"
                onClick={() => { setIsZonesModalOpen(false); setEditingZoneIndex(null); setNewZoneName(''); }}
                aria-label="Cerrar"
                className="p-1.5 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {branchZones.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">Sin zonas todavía. Agrega la primera abajo.</p>
              )}
              {branchZones.map((zone, index) => (
                <div key={zone} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                  {editingZoneIndex === index ? (
                    <>
                      <input
                        type="text"
                        value={editingZoneValue}
                        onChange={e => setEditingZoneValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameZone(index); if (e.key === 'Escape') setEditingZoneIndex(null); }}
                        autoFocus
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-1 focus:ring-[var(--brand-primary,#6366f1)]"
                      />
                      <button type="button" onClick={() => handleRenameZone(index)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer transition" title="Guardar">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditingZoneIndex(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg cursor-pointer transition" title="Cancelar">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-xs font-bold truncate">{zone}</span>
                      <button
                        type="button"
                        onClick={() => { setEditingZoneIndex(index); setEditingZoneValue(zone); }}
                        className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg cursor-pointer transition"
                        title="Renombrar"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteZone(index)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition"
                        title="Eliminar zona"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
              <input
                type="text"
                value={newZoneName}
                onChange={e => setNewZoneName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddZone(); }}
                placeholder="Nueva zona (ej. Rooftop)"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[var(--brand-primary,#6366f1)]"
              />
              <button
                type="button"
                onClick={handleAddZone}
                className="px-3 py-2 bg-[var(--brand-primary,#6366f1)] hover:bg-[color-mix(in_srgb,var(--brand-primary,#6366f1)_90%,black)] text-white rounded-xl cursor-pointer transition"
                title="Agregar zona"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
