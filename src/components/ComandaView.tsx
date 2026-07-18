import React, { useState, useMemo } from 'react';
import {
  X, Plus, Minus, Trash2, Send, DollarSign, Search,
  Clock, User, Users, ShieldAlert, CreditCard, ChevronRight,
  ArrowLeft, Check, Ticket, HelpCircle, Lock, AlertCircle,
  Banknote, Smartphone, Handshake
} from 'lucide-react';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { printEscPosOverNetwork } from '../lib/networkPrinter';
import { buildComandaTicket, columnsForPaperWidth } from '../lib/escpos';
import { formatMXN } from '../lib/format';

interface Product {
  id: string;
  name: string;
  category: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  branchStocks?: { [branchId: string]: number };
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

interface PrintConfig {
  paperWidth: '58mm' | '80mm' | 'A4';
  showLogo: boolean;
  showTaxLine: boolean;
  footerText: string;
  kitchenPrinterIp?: string;
  kitchenPrinterPort?: number;
  barPrinterIp?: string;
  barPrinterPort?: number;
}

interface ComandaViewProps {
  table: Table;
  order: Order | null;
  products: Product[];
  customers: Customer[];
  activeCompanyId: string;
  selectedBranchId: string;
  currentUserMember: any;
  user: any;
  buildAndCommitSale: (params: any) => any;
  onClose: () => void;
  onSaleComplete: (sale: any) => void;
  printConfig?: PrintConfig;
  onPrintReceipt?: (sale: any, options?: any) => void;
  onPrintPrecuenta?: (order: any, table: any, options?: any) => void;
  cashRegisterIsOpen?: boolean;
}

const getProductStock = (prod: Product, branchId: string): number => {
  if (!prod.branchStocks) return prod.stock;
  return prod.branchStocks[branchId] !== undefined ? prod.branchStocks[branchId] : prod.stock;
};

export default function ComandaView({
  table,
  order,
  products,
  customers,
  activeCompanyId,
  selectedBranchId,
  currentUserMember,
  user,
  buildAndCommitSale,
  onClose,
  onSaleComplete,
  printConfig,
  onPrintReceipt,
  onPrintPrecuenta,
  cashRegisterIsOpen = true
}: ComandaViewProps) {
  // Navigation & Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [activeMobileTab, setActiveMobileTab] = useState<'comanda' | 'menu'>('comanda');

  // Checkout State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card' | 'Transfer' | 'Credit'>('Cash');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [discountType, setDiscountType] = useState<'val' | 'pct'>('pct');
  const [discountVal, setDiscountVal] = useState(0);
  const [taxPct, setTaxPct] = useState(0);
  const [folioNumber, setFolioNumber] = useState('');
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const [receivedCashAmount, setReceivedCashAmount] = useState('');
  const [isSubmittingCheckout, setIsSubmittingCheckout] = useState(false);
  const [isPrintingPrecuenta, setIsPrintingPrecuenta] = useState(false);

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

  // Toast notification system
  const [toasts, setToasts] = useState<{
    id: number;
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
  }[]>([]);

  const showToast = (type: 'success' | 'error' | 'warning', title: string, message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Categories list
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => p.category && cats.add(p.category));
    return ['Todos', ...Array.from(cats)];
  }, [products]);

  // Filtered Products checking branch stock
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            (p.category && p.category.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCat = selectedCategory === 'Todos' || p.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [products, searchTerm, selectedCategory]);

  // Group items by round
  const groupedRounds = useMemo(() => {
    if (!order) return { sent: {}, draft: [] };
    const sent: { [round: number]: OrderItem[] } = {};
    const draft: OrderItem[] = [];

    order.items.forEach(item => {
      if (item.sentAt) {
        if (!sent[item.round]) sent[item.round] = [];
        sent[item.round].push(item);
      } else {
        draft.push(item);
      }
    });

    return { sent, draft };
  }, [order]);

  // Calculate totals
  const totals = useMemo(() => {
    if (!order) return { subtotal: 0, discount: 0, tax: 0, total: 0 };
    const subtotal = order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const calculatedDiscount = discountType === 'pct' ? (subtotal * discountVal / 100) : discountVal;
    const discountedTotal = Math.max(0, subtotal - calculatedDiscount);
    const taxValue = discountedTotal * taxPct / 100;
    const total = discountedTotal + taxValue;
    return { subtotal, discount: calculatedDiscount, tax: taxValue, total };
  }, [order, discountType, discountVal, taxPct]);

  // Open Table / Create new Order
  const handleOpenTable = async () => {
    if (!activeCompanyId) return;
    const orderId = 'ord_' + Math.floor(Math.random() * 900000 + 100000);
    const newOrder: Order = {
      id: orderId,
      tableId: table.id,
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
      batch.update(doc(db, 'companies', activeCompanyId, 'tables', table.id), {
        status: 'ocupada',
        currentOrderId: orderId
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/orders/${orderId}`);
    }
  };

  // Add Item to Order (Draft)
  const handleAddItem = async (product: Product) => {
    if (!order || !activeCompanyId) return;

    const availableStock = getProductStock(product, selectedBranchId);
    
    const existingTotalQty = order.items
      .filter(it => it.productId === product.id)
      .reduce((sum, it) => sum + it.quantity, 0);

    if (existingTotalQty + 1 > availableStock) {
      showToast('warning', 'Stock insuficiente', `No hay stock suficiente de "${product.name}" en esta sucursal. Disponible: ${availableStock} u. Ya solicitado: ${existingTotalQty} u.`);
      return;
    }

    const updatedItems = [...order.items];
    const draftIndex = updatedItems.findIndex(it => it.productId === product.id && !it.sentAt);

    if (draftIndex !== -1) {
      updatedItems[draftIndex].quantity += 1;
    } else {
      updatedItems.push({
        productId: product.id,
        name: product.name,
        quantity: 1,
        unitPrice: product.salePrice,
        destination: product.printDestination || 'ninguno',
        round: 0
      });
    }

    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'orders', order.id), {
        items: updatedItems
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/orders/${order.id}`);
    }
  };

  // Update Item Quantity (Draft only)
  const handleUpdateQty = async (productId: string, delta: number) => {
    if (!order || !activeCompanyId) return;

    const updatedItems = [...order.items];
    const draftIndex = updatedItems.findIndex(it => it.productId === productId && !it.sentAt);
    if (draftIndex === -1) return;

    const item = updatedItems[draftIndex];
    
    if (delta > 0) {
      const liveProduct = products.find(p => p.id === productId);
      if (liveProduct) {
        const availableStock = getProductStock(liveProduct, selectedBranchId);
        const existingTotalQty = updatedItems
          .filter(it => it.productId === productId)
          .reduce((sum, it) => sum + it.quantity, 0);

        if (existingTotalQty + delta > availableStock) {
          showToast('warning', 'Stock insuficiente', `No hay stock suficiente de "${item.name}". Disponible: ${availableStock} u.`);
          return;
        }
      }
    }

    item.quantity += delta;
    if (item.quantity <= 0) {
      updatedItems.splice(draftIndex, 1);
    }

    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'orders', order.id), {
        items: updatedItems
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/orders/${order.id}`);
    }
  };

  // Remove Item completely (Draft only)
  const handleRemoveItem = async (productId: string) => {
    if (!order || !activeCompanyId) return;

    const updatedItems = order.items.filter(it => !(it.productId === productId && !it.sentAt));

    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'orders', order.id), {
        items: updatedItems
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/orders/${order.id}`);
    }
  };

  // Enviar a Cocina / Barra (Fire current draft items as a new round)
  const handleSendRound = async () => {
    if (!order || !activeCompanyId || groupedRounds.draft.length === 0) return;

    const maxRound = order.items.reduce((max, item) => Math.max(max, item.round), 0);
    const newRoundNum = maxRound + 1;
    const sentTime = new Date().toISOString();

    const updatedItems = order.items.map(item => {
      if (!item.sentAt) {
        return {
          ...item,
          round: newRoundNum,
          sentAt: sentTime
        };
      }
      return item;
    });

    // Network printing to cocina/barra (Fase 5b)
    if (Capacitor.isNativePlatform() && printConfig) {
      const columns = columnsForPaperWidth(printConfig.paperWidth);
      const timestampFormatted = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      
      const cocinaItems = groupedRounds.draft.filter(it => it.destination === 'cocina');
      const barraItems = groupedRounds.draft.filter(it => it.destination === 'barra');

      if (cocinaItems.length > 0) {
        if (printConfig.kitchenPrinterIp) {
          try {
            const bytes = buildComandaTicket({
              destinationLabel: 'COCINA',
              tableName: table.name,
              waiterName: order.waiterName,
              round: newRoundNum,
              timestamp: timestampFormatted,
              items: cocinaItems.map(it => ({ quantity: it.quantity, name: it.name })),
              columns
            });
            await printEscPosOverNetwork(
              printConfig.kitchenPrinterIp,
              printConfig.kitchenPrinterPort || 9100,
              bytes
            );
          } catch (printErr: any) {
            console.error('Error al imprimir en Cocina:', printErr);
            showToast('error', 'Error de impresora · Cocina', printErr.message || String(printErr));
          }
        } else {
          console.warn('Impresión de Cocina omitida: No hay IP configurada.');
        }
      }

      if (barraItems.length > 0) {
        if (printConfig.barPrinterIp) {
          try {
            const bytes = buildComandaTicket({
              destinationLabel: 'BARRA',
              tableName: table.name,
              waiterName: order.waiterName,
              round: newRoundNum,
              timestamp: timestampFormatted,
              items: barraItems.map(it => ({ quantity: it.quantity, name: it.name })),
              columns
            });
            await printEscPosOverNetwork(
              printConfig.barPrinterIp,
              printConfig.barPrinterPort || 9100,
              bytes
            );
          } catch (printErr: any) {
            console.error('Error al imprimir en Barra:', printErr);
            showToast('error', 'Error de impresora · Barra', printErr.message || String(printErr));
          }
        } else {
          console.warn('Impresión de Barra omitida: No hay IP configurada.');
        }
      }
    }

    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'orders', order.id), {
        items: updatedItems
      });
      showToast('success', `Ronda #${newRoundNum} enviada`, 'Los artículos fueron enviados a cocina/barra correctamente.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/orders/${order.id}`);
      showToast('error', 'Error al enviar ronda', 'No se pudo registrar la ronda. Intenta de nuevo.');
    }
  };

  // Close Account (Process checkout and update status in Firestore)
  const handleConfirmCheckout = async () => {
    if (!order || !activeCompanyId) return;

    if (paymentMethod === 'Credit' && !selectedCustomer) {
      showToast('warning', 'Cliente requerido', 'Selecciona un cliente para registrar la venta al crédito ("Fiado").');
      return;
    }

    if ((paymentMethod === 'Card' || paymentMethod === 'Transfer') && !folioNumber.trim()) {
      showToast('warning', 'Folio requerido', 'Para pagos con Tarjeta o Transferencia es obligatorio ingresar el número de Folio.');
      return;
    }

    setIsSubmittingCheckout(true);

    try {
      const saleItems = order.items.map(it => ({
        productId: it.productId,
        name: it.name,
        quantity: it.quantity,
        salePrice: it.unitPrice
      }));

      const newSale = buildAndCommitSale({
        items: saleItems,
        paymentMethod,
        branchId: selectedBranchId,
        discount: totals.discount,
        taxAmount: totals.tax,
        customerId: selectedCustomer?.id || undefined,
        customerName: selectedCustomer?.name || undefined,
        folio: (paymentMethod === 'Card' || paymentMethod === 'Transfer') ? folioNumber.trim() : undefined,
        requiresInvoice,
        extra: {
          orderId: order.id,
          tableId: table.id,
          waiterName: order.waiterName
        }
      });

      const batch = writeBatch(db);
      batch.update(doc(db, 'companies', activeCompanyId, 'orders', order.id), {
        status: 'closed',
        closedAt: new Date().toISOString(),
        saleId: newSale.id
      });
      batch.update(doc(db, 'companies', activeCompanyId, 'tables', table.id), {
        status: 'libre',
        currentOrderId: null,
        precuentaPrinted: false
      });

      await batch.commit();

      if (onPrintReceipt) {
        onPrintReceipt(newSale, {
          onSuccess: () => {
            showToast('success', 'Ticket impreso', 'El ticket de venta se envió a la impresora.');
          },
          onError: (msg) => {
            showToast('error', 'Error al imprimir', msg);
          }
        });
      }

      showToast('success', '¡Mesa cobrada!', `Venta registrada correctamente. Folio: ${newSale.id.slice(-8).toUpperCase()}`);
      setIsCheckoutOpen(false);
      if (onSaleComplete) {
        onSaleComplete(newSale);
      }
      // Increased delay so the success toasts (paid and printed) are visible before unmounting
      setTimeout(() => onClose(), 4000);
    } catch (err: any) {
      console.error(err);
      showToast('error', 'Error al cobrar', err.message || String(err));
    } finally {
      setIsSubmittingCheckout(false);
    }
  };

  const handleRequestPrecuenta = async () => {
    if (!order || !activeCompanyId) return;

    if (groupedRounds.draft.length > 0) {
      showToast('warning', 'Ronda pendiente', 'Hay artículos en borrador que aún no se enviaron a cocina/barra. Envíalos o elimínalos antes de pedir la cuenta.');
      return;
    }

    const sentItems = order.items.filter(it => !!it.sentAt);
    if (sentItems.length === 0) {
      showToast('warning', 'Sin pedido enviado', 'No se ha enviado ningún pedido a cocina o barra. Agrega artículos y envíalos antes de pedir la cuenta.');
      return;
    }

    setIsPrintingPrecuenta(true);

    try {
      const isMesero = currentUserMember?.role === 'mesero';

      await updateDoc(doc(db, 'companies', activeCompanyId, 'tables', table.id), {
        status: 'por_cobrar',
        precuentaPrinted: isMesero ? false : true
      });

      if (!isMesero && onPrintPrecuenta) {
        onPrintPrecuenta(
          {
            id: order.id,
            waiterName: order.waiterName,
            openedAt: order.openedAt,
            items: sentItems.map(it => ({ name: it.name, quantity: it.quantity, unitPrice: it.unitPrice }))
          },
          { name: table.name },
          {
            onSuccess: () => {
              showToast('success', 'Pre-cuenta impresa', 'El ticket de pre-cuenta se envió a la impresora.');
            },
            onError: (msg) => {
              showToast('error', 'Error al imprimir pre-cuenta', msg);
            }
          }
        );
      } else {
        showToast('success', 'Cuenta solicitada', isMesero ? 'La cuenta ha sido solicitada a caja.' : 'La cuenta ha sido solicitada correctamente.');
      }
    } catch (err: any) {
      console.error(err);
      showToast('error', 'Error al solicitar cuenta', err.message || String(err));
    } finally {
      setIsPrintingPrecuenta(false);
    }
  };

  const elapsedMinutes = order ? Math.floor((Date.now() - Date.parse(order.openedAt)) / 60000) : 0;
  const changeAmount = receivedCashAmount ? parseFloat(receivedCashAmount) - totals.total : 0;

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)] overflow-hidden">
      
      {/* Mobile Tab Switcher */}
      {order && (
        <div className="flex lg:hidden bg-slate-100 p-1 rounded-2xl border border-slate-200 shrink-0 gap-1 mb-1">
          <button
            type="button"
            onClick={() => setActiveMobileTab('comanda')}
            className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMobileTab === 'comanda'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-150'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>Ver Comanda</span>
            {groupedRounds.draft.length > 0 && (
              <span className="bg-rose-500 text-white font-black text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {groupedRounds.draft.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveMobileTab('menu')}
            className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMobileTab === 'menu'
                ? 'bg-white text-slate-800 shadow-sm border border-slate-150'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Menú / Catálogo</span>
          </button>
        </div>
      )}

      {/* LEFT COLUMN: Order status, round details, and checkout trigger */}
      <div className={`${activeMobileTab === 'comanda' ? 'flex' : 'hidden'} lg:flex-1 lg:max-w-[384px] flex-col bg-white border border-slate-200 rounded-3xl p-5 shadow-sm overflow-hidden h-full`}>
        
        {/* Table Details Header */}
        <div className="flex justify-between items-start pb-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <ArrowLeft className="w-5 h-5 cursor-pointer text-slate-400 hover:text-slate-600" onClick={onClose} />
              <span>Mesa {table.name}</span>
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
              {table.zone || 'Principal'} · Cap. {table.capacity || 4}
            </p>
          </div>
          {order && (
            <span className="text-[9px] font-black uppercase py-1 px-2.5 bg-indigo-50 border border-indigo-150 text-indigo-700 rounded-xl">
              <Clock className="w-2.5 h-2.5 inline mr-0.5" />{elapsedMinutes} min
            </span>
          )}
        </div>

        {/* Order Details Body */}
        {!order ? (
          <div className="flex-1 flex flex-col justify-center items-center p-6 text-center space-y-4 shrink-0">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100">
              <Check className="w-8 h-8 text-emerald-600 animate-bounce" />
            </div>
            <div>
              <h4 className="font-extrabold text-sm text-slate-800">La mesa está libre</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">Abre la mesa para registrar comandas y asociarle un mesero.</p>
            </div>
            <button
              onClick={handleOpenTable}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer uppercase tracking-wider active:scale-95"
            >
              Abrir Mesa / Tomar Orden
            </button>
          </div>
        ) : (
          <div className="flex-grow flex flex-col overflow-hidden pt-4 space-y-4 justify-between">
            
            {/* Status indicators */}
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2 shrink-0 text-xs">
              <div className="flex items-center gap-1.5 text-slate-500 font-semibold">
                <User className="w-3.5 h-3.5" />
                <span>{order.waiterName}</span>
              </div>
              <span className="text-[10px] text-indigo-600 font-extrabold bg-indigo-50 px-2 py-0.5 rounded">
                ID: {order.id.slice(-6).toUpperCase()}
              </span>
            </div>

            {/* Rounds List Scrollable */}
            <div className="flex-grow overflow-y-auto space-y-4 pr-1">
              
              {/* 1. Borrador / Draft Items */}
              {groupedRounds.draft.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    <span>Ronda en Borrador (Pendiente de enviar)</span>
                  </h4>
                  <div className="space-y-1.5">
                    {groupedRounds.draft.map((item, idx) => (
                      <div key={`draft-${idx}`} className="flex justify-between items-center bg-slate-50 border border-slate-200 p-2.5 rounded-xl shadow-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-extrabold text-slate-800 truncate">{item.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold">
                            {formatMXN(item.unitPrice)} c/u · <span className="uppercase text-[9px] text-indigo-500">{item.destination}</span>
                          </p>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0 ml-3">
                          <button
                            onClick={() => handleUpdateQty(item.productId, -1)}
                            className="p-1 rounded-md border bg-white hover:bg-slate-100 border-slate-200 text-slate-600 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-black text-slate-855 w-4 text-center">{item.quantity}</span>
                          <button
                            onClick={() => handleUpdateQty(item.productId, 1)}
                            className="p-1 rounded-md border bg-white hover:bg-slate-100 border-slate-200 text-slate-600 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleRemoveItem(item.productId)}
                            className="p-1 rounded-md border bg-red-50 hover:bg-red-100 border-red-200 text-red-500 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleSendRound}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar a Cocina / Barra</span>
                  </button>
                </div>
              )}

              {/* 2. Sent Rounds */}
              {Object.keys(groupedRounds.sent).length > 0 ? (
                Object.keys(groupedRounds.sent)
                  .sort((a, b) => Number(b) - Number(a))
                  .map(roundNumStr => {
                    const rNum = Number(roundNumStr);
                    const rItems = groupedRounds.sent[rNum];
                    return (
                      <div key={`round-${rNum}`} className="space-y-1.5 border-t border-slate-100 pt-3">
                        <div className="flex justify-between items-center">
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                            Ronda #{rNum} (Enviada)
                          </h4>
                          <span className="text-[9px] text-slate-450 font-bold flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />Listo / En Preparación
                          </span>
                        </div>
                        <div className="space-y-1">
                          {rItems.map((item, idx) => (
                            <div key={`sent-${rNum}-${idx}`} className="flex justify-between items-center bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-650 truncate">{item.name}</p>
                                <p className="text-[9px] text-slate-400 font-bold">
                                  {item.quantity}x @ {formatMXN(item.unitPrice)} · <span className="uppercase text-[8px] text-indigo-400">{item.destination}</span>
                                </p>
                              </div>
                              <span className="text-xs font-bold text-slate-500 pr-1">
                                {formatMXN(item.unitPrice * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
              ) : (
                groupedRounds.draft.length === 0 && (
                  <div className="flex-grow flex flex-col justify-center items-center py-10 text-center text-slate-400">
                    <Users className="w-8 h-8 mb-2 stroke-1 text-slate-350" />
                    <p className="text-xs font-medium">Mesa vacía. Agrega platillos desde el catálogo.</p>
                  </div>
                )
              )}
            </div>

            {/* Bottom Bill Panel & Checkout Action */}
            <div className="border-t border-slate-100 pt-4 space-y-4 shrink-0 bg-white">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>{formatMXN(totals.subtotal)}</span>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-rose-500">
                    <span>Descuento</span>
                    <span>-{formatMXN(totals.discount)}</span>
                  </div>
                )}
                {totals.tax > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>IVA</span>
                    <span>{formatMXN(totals.tax)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-base font-black text-slate-800 pt-1">
                  <span>Total Cuenta</span>
                  <span className="text-lg text-[var(--brand-primary,#6366f1)]">{formatMXN(totals.total)}</span>
                </div>
              </div>

              {order.status === 'closed' ? (
                <div className="p-3 bg-slate-100 rounded-xl text-center border border-slate-200">
                  <span className="text-xs font-black uppercase text-slate-500 flex items-center justify-center gap-1.5">
                    <Check className="w-4 h-4" />Comanda Cerrada & Cobrada
                  </span>
                </div>
              ) : order.items.length > 0 ? (
                currentUserMember?.role === 'mesero' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleRequestPrecuenta}
                      disabled={isPrintingPrecuenta}
                      className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer text-center uppercase tracking-wider active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Ticket className="w-4 h-4" />
                      <span>
                        {isPrintingPrecuenta
                          ? 'Imprimiendo...'
                          : table.status === 'por_cobrar'
                          ? 'Reimprimir Pre-cuenta'
                          : 'Pedir Cuenta / Pre-cuenta'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleRequestPrecuenta}
                      disabled={isPrintingPrecuenta}
                      className="py-3 px-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-355 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer flex items-center justify-center gap-1 active:scale-95 disabled:opacity-50"
                      title="Imprimir Pre-cuenta"
                    >
                      <Ticket className="w-4 h-4" />
                      <span className="hidden sm:inline">Pre-cuenta</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!cashRegisterIsOpen) {
                          showToast('warning', 'Caja cerrada', 'No se pueden cobrar cuentas con la caja cerrada. Por favor, realiza la apertura de caja desde el panel de control.');
                          return;
                        }
                        if (groupedRounds.draft.length > 0) {
                          showToast('warning', 'Ronda pendiente', 'Hay artículos en borrador que aún no se enviaron a cocina/barra. Envíalos o elimínalos antes de cobrar.');
                          return;
                        }
                        const hasSentItems = order.items.some(it => !!it.sentAt);
                        if (!hasSentItems) {
                          showToast('warning', 'Sin pedido enviado', 'No se ha enviado ningún pedido a cocina o barra. Agrega artículos y envíalos antes de cobrar la mesa.');
                          return;
                        }
                        setIsCheckoutOpen(true);
                      }}
                      className={`flex-1 py-3 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer text-center uppercase tracking-wider active:scale-95 flex items-center justify-center gap-1.5 ${
                        cashRegisterIsOpen
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-slate-400 cursor-not-allowed opacity-60'
                      }`}
                    >
                      <DollarSign className="w-4 h-4" />Cobrar Cuenta
                    </button>
                  </div>
                )
              ) : currentUserMember?.role !== 'mesero' ? (
                <button
                  type="button"
                  onClick={async () => {
                    showConfirm(
                      '¿Liberar Mesa sin Consumo?',
                      `¿Desea cerrar y liberar la ${table.name} sin consumir? Se cerrará la comanda activa sin registrar cobro en caja.`,
                      async () => {
                        try {
                          const batch = writeBatch(db);
                          batch.update(doc(db, 'companies', activeCompanyId, 'orders', order.id), {
                            status: 'closed',
                            closedAt: new Date().toISOString()
                          });
                          batch.update(doc(db, 'companies', activeCompanyId, 'tables', table.id), {
                            status: 'libre',
                            currentOrderId: null,
                            precuentaPrinted: false
                          });
                          await batch.commit();
                          onClose();
                        } catch (err) {
                          handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/tables/${table.id}`);
                        }
                      }
                    );
                  }}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold text-[10px] uppercase rounded-xl transition cursor-pointer text-center tracking-wide"
                >
                  Liberar Mesa Sin Consumo
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Product Catalog selection */}
      {order && (
        <div className={`${activeMobileTab === 'menu' ? 'flex-grow' : 'hidden'} lg:flex flex-grow flex-col bg-white border border-slate-200 rounded-3xl p-5 shadow-sm overflow-hidden h-full`}>
          
          {/* Search and Categories bar */}
          <div className="space-y-3 shrink-0 pb-3 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar platillo, bebida o postre..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-xs outline-none focus:border-[var(--brand-primary,#6366f1)] focus:ring-1 focus:ring-[var(--brand-primary,#6366f1)] font-medium text-slate-750"
              />
            </div>

            {/* Category selection horizontal slider */}
            <div className="flex overflow-x-auto gap-1.5 pb-1 scrollbar-none">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-[10px] font-black uppercase px-3.5 py-1.5 rounded-full border cursor-pointer shrink-0 transition select-none ${
                    selectedCategory === cat
                      ? 'bg-[var(--brand-primary,#6366f1)] border-[var(--brand-primary,#6366f1)] text-white shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Grid Products list */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 p-1.5 mt-2">
            {filteredProducts.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-center text-slate-450">
                <HelpCircle className="w-10 h-10 mb-2 stroke-1" />
                <h5 className="font-extrabold text-xs uppercase tracking-wider text-slate-500">Sin coincidencias</h5>
                <p className="text-[10px] mt-1">No se encontraron productos en esta categoría.</p>
              </div>
            ) : (
              filteredProducts.map(prod => {
                const stock = getProductStock(prod, selectedBranchId);
                const isOutOfStock = stock <= 0;
                
                return (
                  <button
                    key={prod.id}
                    disabled={isOutOfStock}
                    onClick={() => handleAddItem(prod)}
                    className={`border rounded-2xl p-3 flex flex-col justify-between text-left cursor-pointer transition relative group h-36 ${
                      isOutOfStock
                        ? 'bg-slate-50 border-slate-200 opacity-40 cursor-not-allowed'
                        : 'bg-white border-slate-200 hover:border-[var(--brand-primary,#6366f1)] hover:shadow-md'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-1 w-full">
                        <span className="text-[8px] bg-slate-50 border border-slate-150 px-1.5 py-0.5 rounded text-slate-500 font-extrabold truncate max-w-[80px]">
                          {prod.category}
                        </span>
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${
                          stock <= 5 
                            ? 'bg-rose-100 text-rose-800' 
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          Stock: {stock}
                        </span>
                      </div>
                      <h4 className="text-xs font-extrabold text-slate-800 mt-2 group-hover:text-[var(--brand-primary,#6366f1)] line-clamp-2 pr-1 leading-snug">
                        {prod.name}
                      </h4>
                    </div>

                    <div className="flex justify-between items-end mt-2 pt-2 border-t border-slate-50 w-full shrink-0">
                      <span className="text-xs font-black text-slate-800">
                        {formatMXN(prod.salePrice)}
                      </span>
                      <span className="text-[9px] font-black uppercase px-2 py-1 bg-indigo-50 border border-indigo-150 text-indigo-700 rounded-lg group-hover:bg-[var(--brand-primary,#6366f1)] group-hover:text-white group-hover:border-[var(--brand-primary,#6366f1)] transition">
                        + Añadir
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

        </div>
      )}

      {/* CHECKOUT MODAL WINDOW */}
      {isCheckoutOpen && order && (
        <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-150 flex justify-between items-center">
              <div>
                <h3 className="text-base font-black text-slate-800 flex items-center gap-1.5">
                  <Ticket className="w-5 h-5 text-indigo-500" />
                  <span>Cierre de Cuenta — Mesa {table.name}</span>
                </h3>
                <p className="text-[10px] text-slate-450 font-bold uppercase mt-0.5">Folio Comanda: {order.id}</p>
              </div>
              <button
                onClick={() => setIsCheckoutOpen(false)}
                aria-label="Cerrar"
                className="text-slate-400 hover:text-slate-600 font-extrabold text-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Checkout details overview grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* LHS: Select Payment Method & Details */}
                <div className="space-y-4">
                  <span className="text-[10px] font-black uppercase text-slate-405 tracking-wider block">Método de Pago</span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'Cash', label: 'Efectivo', icon: Banknote },
                      { id: 'Card', label: 'Tarjeta', icon: CreditCard },
                      { id: 'Transfer', label: 'Transf.', icon: Smartphone },
                      { id: 'Credit', label: 'Crédito / Fiado', icon: Handshake }
                    ] as const).map(method => (
                      <button
                        key={method.id}
                        onClick={() => {
                          setPaymentMethod(method.id);
                          if (method.id !== 'Credit') setSelectedCustomer(null);
                        }}
                        className={`p-3 rounded-xl border-2 text-xs font-black text-center cursor-pointer transition select-none active:scale-95 flex flex-col items-center gap-1 ${
                          paymentMethod === method.id
                            ? 'border-[var(--brand-primary,#6366f1)] bg-indigo-50/50 text-[var(--brand-primary,#6366f1)]'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-650'
                        }`}
                      >
                        <method.icon className="w-4 h-4" />
                        {method.label}
                      </button>
                    ))}
                  </div>

                  {/* Cash Flow Inputs */}
                  {paymentMethod === 'Cash' && (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150 space-y-3">
                      <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Efectivo Recibido
                      </label>
                      <div className="relative">
                        <DollarSign className="w-4 h-4 text-slate-450 absolute left-3 top-3" />
                        <input
                          type="number"
                          value={receivedCashAmount}
                          onChange={e => setReceivedCashAmount(e.target.value)}
                          placeholder="Monto entregado por cliente..."
                          className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-2.5 text-xs outline-none focus:border-[var(--brand-primary,#6366f1)] font-semibold text-slate-700"
                        />
                      </div>
                      {receivedCashAmount && (
                        <div className="flex justify-between items-center text-xs font-bold mt-1">
                          <span className="text-slate-500">Cambio:</span>
                          <span className={`font-black text-sm ${changeAmount < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                            {changeAmount < 0 
                              ? `Faltan ${formatMXN(Math.abs(changeAmount))}` 
                              : formatMXN(changeAmount)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Authorization Folio for Card / Transfer */}
                  {(paymentMethod === 'Card' || paymentMethod === 'Transfer') && (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150 space-y-2">
                      <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Número de Folio / Referencia *
                      </label>
                      <input
                        type="text"
                        value={folioNumber}
                        onChange={e => setFolioNumber(e.target.value)}
                        placeholder="Ej. 123456"
                        required
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-[var(--brand-primary,#6366f1)] font-medium text-slate-700"
                      />
                    </div>
                  )}

                  {/* Customer Selector for credit or invoicing */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">
                      Cliente {paymentMethod === 'Credit' ? '*' : '(Opcional)'}
                    </span>
                    <select
                      value={selectedCustomer?.id || ''}
                      onChange={e => {
                        const cust = customers.find(c => c.id === e.target.value) || null;
                        setSelectedCustomer(cust);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-[var(--brand-primary,#6366f1)] text-slate-700"
                    >
                      <option value="">-- Seleccionar Cliente --</option>
                      {customers.map(cust => (
                        <option key={cust.id} value={cust.id}>
                          {cust.name} ({cust.phone || 'Sin Tel'}) {cust.unpaidBalance > 0 ? `· Debe: ${formatMXN(cust.unpaidBalance)}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Requires Invoice Toggle */}
                  <label className="flex items-center gap-2.5 p-1 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={requiresInvoice}
                      onChange={e => setRequiresInvoice(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-200 text-[var(--brand-primary,#6366f1)] focus:ring-[var(--brand-primary,#6366f1)]"
                    />
                    <span className="font-semibold text-slate-700">Solicitar Factura Fiscal</span>
                  </label>
                </div>

                {/* RHS: Account breakdown, Discounts, Final metrics */}
                <div className="space-y-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Descuentos y Ajustes</span>
                    
                    {/* Discount Controls */}
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-150 space-y-3 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-500">Tipo de Descuento:</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => { setDiscountType('pct'); setDiscountVal(0); }}
                            className={`px-2 py-1 text-[10px] font-black rounded-lg border ${
                              discountType === 'pct' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
                            }`}
                          >
                            % Porcentaje
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDiscountType('val'); setDiscountVal(0); }}
                            className={`px-2 py-1 text-[10px] font-black rounded-lg border ${
                              discountType === 'val' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
                            }`}
                          >
                            $ Valor Fijo
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <input
                          type="number"
                          value={discountVal || ''}
                          onChange={e => setDiscountVal(Math.max(0, parseFloat(e.target.value) || 0))}
                          placeholder={discountType === 'pct' ? 'Ej. 10 (para 10%)' : 'Ej. 50 (para $50)'}
                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs outline-none focus:border-[var(--brand-primary,#6366f1)] font-semibold text-slate-700"
                        />
                      </div>

                      {/* Tax Settings Selector */}
                      <div className="flex justify-between items-center pt-2 border-t border-slate-200/50">
                        <span className="font-bold text-slate-500">Impuesto (IVA):</span>
                        <select
                          value={taxPct}
                          onChange={e => setTaxPct(parseInt(e.target.value) || 0)}
                          className="bg-white border border-slate-250 rounded px-2 py-1 font-semibold text-[11px]"
                        >
                          <option value="0">Sin IVA (0%)</option>
                          <option value="16">IVA General (16%)</option>
                          <option value="8">IVA Frontera (8%)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Account Summary Panel */}
                  <div className="bg-slate-900 text-white rounded-2xl p-4.5 space-y-2.5">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Subtotal de Artículos</span>
                      <span>{formatMXN(totals.subtotal)}</span>
                    </div>
                    {totals.discount > 0 && (
                      <div className="flex justify-between text-xs text-rose-455 font-medium">
                        <span>Descuento Aplicado</span>
                        <span>-{formatMXN(totals.discount)}</span>
                      </div>
                    )}
                    {totals.tax > 0 && (
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Impuestos ({taxPct}%)</span>
                        <span>{formatMXN(totals.tax)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center border-t border-slate-800 pt-3 mt-1">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">Total Neto a Cobrar</span>
                      <span className="text-xl font-black text-emerald-400">{formatMXN(totals.total)}</span>
                    </div>
                  </div>

                </div>

              </div>

            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-150 flex justify-end gap-3.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsCheckoutOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-black uppercase text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmittingCheckout || (paymentMethod === 'Cash' && changeAmount < 0)}
                onClick={handleConfirmCheckout}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.99] text-white text-xs font-black uppercase rounded-xl transition cursor-pointer shadow-md flex items-center gap-1.5"
              >
                {isSubmittingCheckout ? 'Procesando...' : (<><CreditCard className="w-4 h-4" />Confirmar y Cobrar Cuenta</>)}
              </button>
            </div>

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
                  className="flex-1 py-2.5 border border-slate-200 text-slate-650 hover:bg-slate-50 text-xs font-black rounded-xl uppercase tracking-wider transition cursor-pointer text-center"
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

      {/* ── Toast Notification Stack — Banner completo con color sólido ── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[200] flex flex-col pointer-events-none">
          {toasts.map(toast => {
            const isSuccess = toast.type === 'success';
            const isError   = toast.type === 'error';
            const bgClass   = isSuccess
              ? 'bg-emerald-600'
              : isError
              ? 'bg-rose-600'
              : 'bg-amber-500';
            const icon = isSuccess ? '✅' : isError ? '❌' : '⚠️';
            return (
              <div
                key={toast.id}
                className={`pointer-events-auto relative flex items-center w-full overflow-hidden shadow-2xl ${bgClass} text-white border-t border-white/10`}
                style={{ animation: 'bannerSlideUp 0.4s cubic-bezier(0.34,1.4,0.64,1) both' }}
              >
                {/* Icon */}
                <div className="flex items-center px-4 py-3.5 shrink-0 text-2xl">
                  {icon}
                </div>

                {/* Text */}
                <div className="flex-1 flex flex-col justify-center py-3.5 min-w-0">
                  <span className="font-black text-xs uppercase tracking-wider opacity-100 leading-tight">
                    {toast.title}
                  </span>
                  <span className="text-[12px] font-medium opacity-90 mt-0.5 leading-snug break-words">
                    {toast.message}
                  </span>
                </div>

                {/* Close */}
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="shrink-0 flex items-center px-5 py-3.5 text-white/70 hover:text-white transition cursor-pointer text-lg font-black"
                  title="Cerrar"
                >
                  ✕
                </button>

                {/* Progress bar */}
                <div
                  className="absolute bottom-0 left-0 h-[3px] bg-white/30"
                  style={{ animation: 'toastProgress 4.5s linear forwards' }}
                />
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes bannerSlideUp {
          from { opacity: 0; transform: translateY(100%); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes toastProgress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>

    </div>
  );
}
