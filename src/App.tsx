import React, { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import {
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Receipt,
  Sparkles,
  Plus,
  Trash2,
  Percent,
  CircleDollarSign,
  Check,
  ChevronRight,
  UserPlus,
  ArrowLeft,
  RotateCcw,
  FileText,
  AlertCircle,
  ShieldCheck,
  TrendingUp,
  X,
  Briefcase,
  Layers,
  Store,
  Truck,
  Building2,
  Settings,
  Key,
  Menu,
  Palette,
  MapPin,
  Download,
  Printer,
  LayoutGrid,
  List,
  Utensils,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  TrendingDown,
  MessageCircle,
  Mail
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { formatMXN } from './lib/format';
import { DEFAULT_PRODUCT_CATEGORY } from './lib/constants';

// Firebase integrations
import { auth, db, googleProvider, driveGoogleProvider, OperationType, handleFirestoreError, getCachedAccessToken, setCachedAccessToken } from './firebase';
import { onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, User, signInWithEmailAndPassword, GoogleAuthProvider } from 'firebase/auth';
import { Capacitor, registerPlugin } from '@capacitor/core';

// Thin custom-plugin binding — see android/.../ReceiptPrinterPlugin.java. No npm package for
// this one; it's registered by name only, matching the @CapacitorPlugin("ReceiptPrinter")
// annotation on the native side.
const ReceiptPrinter = registerPlugin<{ print(options: { html: string; jobName?: string }): Promise<{ value: boolean }> }>('ReceiptPrinter');

// Direct ESC/POS printing for Bluetooth thermal printers (e.g. MERION PT-B1) that don't
// implement Android's Print Framework and so never show up in ReceiptPrinter's system dialog —
// see android/.../BluetoothPrinterPlugin.java and src/lib/escpos.ts.
interface BluetoothPrinterDevice { name: string; address: string; }
const BluetoothPrinter = registerPlugin<{
  listPairedDevices(): Promise<{ devices: BluetoothPrinterDevice[] }>;
  printEscPos(options: { address: string; data: string }): Promise<{ value: boolean }>;
}>('BluetoothPrinter');
import { buildReceiptEscPos, buildTestPrint, uint8ToBase64, columnsForPaperWidth, buildPrecuentaEscPos } from './lib/escpos';
import { isWebUsbSupported, requestUsbPrinter, getPairedUsbPrinters, printUsb } from './lib/webUsbPrinter';
import { isWebBluetoothSupported, requestBluetoothPrinter, printBluetooth } from './lib/webBluetoothPrinter';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const isNativePlatform = Capacitor.isNativePlatform();

// En APK usa el SDK nativo de Google (Android Credential Manager) en vez del flujo de
// redirect por WebView — ese flujo requiere que Firebase sirva `/__/auth/handler` por red
// real, algo que Capacitor no puede garantizar cuando la app corre 100% empaquetada
// (ver bug de pantalla blanca, sesión 2026-07-02). Tras el sign-in nativo, el idToken se
// usa para autenticar también el SDK de JS (signInWithCredential), así el resto de la app
// (onAuthStateChanged, reglas de Firestore, etc.) sigue funcionando sin cambios.
const signInWithGoogle = async () => {
  if (isNativePlatform) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('No se recibió el token de acceso de Google.');
    const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
    await signInWithCredential(auth, credential);
    if (result.credential?.accessToken) setCachedAccessToken(result.credential.accessToken);
  } else {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) setCachedAccessToken(credential.accessToken);
  }
};
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  writeBatch,
  getDoc,
  updateDoc,
  increment,
  arrayUnion,
  runTransaction,
  query,
  where
} from 'firebase/firestore';

// Custom Tenant Components
import CompanySelector from './components/CompanySelector';
import CompanySettingsView from './components/CompanySettingsView';
import AuditView from './components/AuditView';
import WaiterShell from './components/WaiterShell';
import EmployeePinLogin from './components/EmployeePinLogin';
import TablesFloorView from './components/TablesFloorView';
import ComandaView from './components/ComandaView';

// UTF-8-safe string → base64 (plain btoa() mangles accented characters like á/é/í/ó/ú/ñ).
const utf8ToBase64 = (str: string): string =>
  btoa(Array.from(new TextEncoder().encode(str), b => String.fromCharCode(b)).join(''));

// Saves a generated file (CSV/PDF) so it actually reaches the user. In a real browser the
// classic Blob + <a download> click reliably triggers the browser's download flow. Inside
// Capacitor's Android WebView that same click does nothing visible — there's no Downloads-
// folder integration for it. On native we instead write the file to the app's cache dir
// (@capacitor/filesystem) and hand it to the OS share sheet (@capacitor/share), where the
// user picks "Guardar en Archivos" / Drive / WhatsApp / etc. Same entry point either way —
// callers just pass the filename, base64 payload, and mime type.
const saveFileOnDevice = async (filename: string, base64Data: string, mimeType: string) => {
  if (isNativePlatform) {
    try {
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });
      await Share.share({
        title: filename,
        url: result.uri,
        dialogTitle: `Guardar ${filename}`,
      });
    } catch (err) {
      console.error('Native file save error:', err);
      alert('No se pudo guardar/compartir el archivo. Intenta de nuevo.');
    }
  } else {
    const byteChars = atob(base64Data);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};

// Interfaces

// Where a product's ticket line should be routed when sent from a restaurant order:
// the kitchen printer, the bar printer, or nowhere (not printed on a station ticket).
// Pre-filled from the product category but always explicit and persisted per product.
type PrintDestination = 'cocina' | 'barra' | 'ninguno';

interface Product {
  id: string;
  name: string;
  category: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  imageUrl?: string;
  sku?: string;
  supplierId?: string; // Associated Suppplier
  branchStocks?: { [branchId: string]: number }; // Branch-specific stocks!
  printDestination?: PrintDestination; // Restaurant mode: which station printer this item goes to
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  unpaidBalance: number; // For "Fiado" (Credit)
  registeredDate: string;
}

interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  salePrice: number;
}

interface Sale {
  id: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: 'Cash' | 'Card' | 'Transfer' | 'Credit'; // 'Credit' is "Fiado"
  customerId?: string;
  customerName?: string;
  timestamp: string;
  createdAt?: number; // epoch ms — used for reliable sorting (timestamp is a locale display string, not parseable)
  status: 'Completed' | 'Refunded';
  branchId?: string; // Associated Branch/Office
  folio?: string; // Reference Folio
  requiresInvoice?: boolean;
  invoiceStatus?: 'pending' | 'completed';
  employeeName?: string; // Who rang up the sale (owner, encargado, or cajero) — "Atendido por"
  // Restaurant mode: traceability back to the table/order this sale was closed from.
  // Additive only — a normal retail sale leaves these undefined.
  orderId?: string;
  tableId?: string;
  waiterName?: string;
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
    createdAt?: number; // epoch ms — lets the monthly PDF filter movements by period
    branchId?: string; // Associated Branch/Office
  }[];
  lastOperationalDate?: string; // e.g. '2026-05-20'
}

interface Branch {
  id: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
  isMatriz?: boolean; // Toggle for main manufacturing branch
  zones?: string[]; // Editable salon zones for Mesas/Salón (e.g. "Terraza", "Bar") — not every restaurant has the same ones, so this replaces a fixed list.
}

// Append-only inventory audit log — one entry per restock ("surtido") or per side of an
// inter-branch transfer. Kept separate from the cash register (which tracks money) so the
// Historial has a clean, dedicated "Movimientos de Inventario" view. `quantity` is units.
interface StockMovement {
  id: string;
  type: 'surtido' | 'merma' | 'transfer_in' | 'transfer_out';
  productId: string;
  productName: string;
  quantity: number;
  branchId: string; // branch whose stock this entry affects
  branchName?: string;
  counterpartBranchId?: string; // the other branch, for transfers
  counterpartBranchName?: string;
  userName?: string;
  timestamp: string; // human-readable display string
  createdAt: number; // epoch ms — for sorting and monthly filtering
}

interface Member {
  userId: string;
  name: string;
  email: string;
  // 'mesero' (waiter) sits at the same privilege level as 'employee' — no elevated
  // rights — but drives the restaurant-specific floor UI (tables/orders) in Fase 2/4.
  role: 'owner' | 'master_admin' | 'admin' | 'employee' | 'mesero';
  joinedAt?: string;
  assignedBranchId?: string;
}

export const getProductStock = (prod: Product, branchId: string): number => {
  if (!prod.branchStocks) return prod.stock;
  return prod.branchStocks[branchId] !== undefined ? prod.branchStocks[branchId] : prod.stock;
};

interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  category: string;
}

interface Branding {
  displayName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  darkColor?: string;
  tagline?: string;
}

interface PrintConfig {
  paperWidth: '58mm' | '80mm' | 'A4';
  showLogo: boolean;
  showTaxLine: boolean;
  footerText: string;
  // Restaurant mode (Android-only split network printing, Fase 5). Empty until configured
  // in the "Impresora" settings subtab; default port is 9100 (raw ESC/POS over TCP).
  kitchenPrinterIp?: string;
  kitchenPrinterPort?: number;
  barPrinterIp?: string;
  barPrinterPort?: number;
}

const DEFAULT_PRINT_CONFIG: PrintConfig = {
  paperWidth: '80mm',
  showLogo: true,
  showTaxLine: true,
  footerText: '¡Gracias por su compra!',
};

// The company registration document (companies/{companyId}). `businessType` gates all the
// restaurant-specific UI (Mesas tab, mesero role, printer IPs) — it stays generic/white-label:
// retail companies omit it or set 'retail', new companies in this repo default to 'restaurante'.
interface Company {
  id: string;
  name: string;
  ownerId: string;
  invitationCode: string;
  createdAt: string;
  businessType?: 'retail' | 'restaurante';
}

// --- Restaurant mode: tables & orders (companies/{companyId}/tables, /orders) ---
// A table on the floor. `status` drives the color/state in the floor grid; `currentOrderId`
// links to the open order while occupied.
interface Table {
  id: string;
  name: string;
  branchId: string;
  capacity?: number;
  status: 'libre' | 'ocupada' | 'por_cobrar';
  currentOrderId?: string;
}

// One line inside an open order. `round` groups items sent together to the kitchen/bar;
// `sentAt` is set once the round has been fired to the station printers (Fase 5) — an
// item with `sentAt` is read-only (the kitchen already started on it).
interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  destination: PrintDestination;
  round: number;
  sentAt?: string;
}

// The "comanda"/open tab — deliberately separate from `Sale`: a Sale is an immutable,
// already-completed financial record that feeds reports/PDFs; an Order is a mutable
// in-progress document (rounds get appended, corrected before sending). On close, a Sale
// is built from `items` (reusing the atomic stock/cash delta helpers) and the order is
// marked closed + linked via `saleId` — it is never deleted (needed for "cuentas cerradas"
// and the audit panel).
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

const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Device-level kiosk binding (Fase 3): once an owner/admin sets this from
// CompanySettingsView, the login gate on this device skips straight to the
// PIN pad for that company instead of showing the full company-code form.
export const KIOSK_COMPANY_STORAGE_KEY = 'logic_kiosk_company_id';

export const getCurrentMonthKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Groups a sale into a "YYYY-MM" bucket. Uses the reliable numeric `createdAt` when
// available; falls back to parsing the legacy `timestamp` display string (best-effort,
// only affects sales recorded before `createdAt` was introduced).
export const getSaleMonthKey = (sale: Sale): string => {
  const ms = sale.createdAt ?? Date.parse(sale.timestamp);
  const d = isNaN(ms) ? new Date() : new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const getMonthLabel = (monthKey: string): string => {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES_ES[(m - 1 + 12) % 12]} ${y}`;
};

// Builds the descending list of month keys ("YYYY-MM") that have at least one sale,
// always including the current month even if it has no sales yet.
export const getAvailableMonths = (allSales: Sale[]): string[] => {
  const keys = new Set<string>([getCurrentMonthKey()]);
  allSales.forEach(s => keys.add(getSaleMonthKey(s)));
  return Array.from(keys).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
};

export default function App() {
  // Tabs: 'pos' | 'products' | 'customers' | 'tables' | 'history' | 'analytics' | 'branches' | 'suppliers' | 'settings' | 'invoicing'
  const [activeTab, setActiveTab] = useState<'products' | 'customers' | 'tables' | 'history' | 'analytics' | 'branches' | 'suppliers' | 'settings' | 'invoicing' | 'audit'>('tables');
  const [branding, setBranding] = useState<Branding>({});

  useEffect(() => {
    try {
      document.documentElement.classList.remove('dark');
      localStorage.removeItem('logicpos_theme');
    } catch (e) {
      console.error(e);
    }
  }, []);
  const [printConfig, setPrintConfig] = useState<PrintConfig>(DEFAULT_PRINT_CONFIG);

  // Selected Bluetooth thermal printer (e.g. MERION PT-B1). Tied to this physical device, not
  // the company/account, so it's kept in localStorage rather than Firestore.
  const [bluetoothPrinter, setBluetoothPrinter] = useState<BluetoothPrinterDevice | null>(() => {
    try {
      const raw = localStorage.getItem('logicpos_bt_printer');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const saveBluetoothPrinter = (device: BluetoothPrinterDevice | null) => {
    setBluetoothPrinter(device);
    if (device) localStorage.setItem('logicpos_bt_printer', JSON.stringify(device));
    else localStorage.removeItem('logicpos_bt_printer');
  };
  const handleScanBluetoothPrinters = async (): Promise<BluetoothPrinterDevice[]> => {
    const { devices } = await BluetoothPrinter.listPairedDevices();
    return devices;
  };
  const handleTestPrintBluetooth = async () => {
    if (!bluetoothPrinter) return;
    const bytes = buildTestPrint(columnsForPaperWidth(printConfig.paperWidth));
    await BluetoothPrinter.printEscPos({ address: bluetoothPrinter.address, data: uint8ToBase64(bytes) });
  };

  // Direct-to-printer for the plain web build (no APK installed) — WebUSB for a cabled
  // printer, Web Bluetooth as a best-effort option for printers whose chip also speaks BLE
  // (see src/lib/webBluetoothPrinter.ts for why classic Bluetooth can't be reached this way).
  // The live device handle only lives in memory for the session; `webPrinterInfo` persists
  // just the display name so the settings screen can show what was last connected.
  const [webUsbDevice, setWebUsbDevice] = useState<USBDevice | null>(null);
  const [webBluetoothDevice, setWebBluetoothDevice] = useState<BluetoothDevice | null>(null);
  const [webPrinterInfo, setWebPrinterInfo] = useState<{ mode: 'usb' | 'bluetooth'; name: string } | null>(() => {
    try {
      const raw = localStorage.getItem('logicpos_web_printer_info');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // WebUSB (unlike Web Bluetooth) can silently reattach a previously-authorized device on
  // load, since the printer is almost certainly still plugged into the same cable.
  React.useEffect(() => {
    if (isNativePlatform) return;
    getPairedUsbPrinters().then(devices => {
      if (devices.length > 0) {
        setWebUsbDevice(devices[0]);
        setWebPrinterInfo({ mode: 'usb', name: devices[0].productName || 'Impresora USB' });
      }
    }).catch(() => {});
  }, []);

  const handleConnectWebUsbPrinter = async () => {
    const device = await requestUsbPrinter();
    setWebUsbDevice(device);
    setWebBluetoothDevice(null);
    const info = { mode: 'usb' as const, name: device.productName || 'Impresora USB' };
    setWebPrinterInfo(info);
    localStorage.setItem('logicpos_web_printer_info', JSON.stringify(info));
  };

  const handleConnectWebBluetoothPrinter = async () => {
    const device = await requestBluetoothPrinter();
    setWebBluetoothDevice(device);
    setWebUsbDevice(null);
    const info = { mode: 'bluetooth' as const, name: device.name || 'Impresora Bluetooth' };
    setWebPrinterInfo(info);
    localStorage.setItem('logicpos_web_printer_info', JSON.stringify(info));
  };

  const handleForgetWebPrinter = () => {
    setWebUsbDevice(null);
    setWebBluetoothDevice(null);
    setWebPrinterInfo(null);
    localStorage.removeItem('logicpos_web_printer_info');
  };

  const handleTestPrintWeb = async () => {
    const bytes = buildTestPrint(columnsForPaperWidth(printConfig.paperWidth));
    if (webUsbDevice) return printUsb(webUsbDevice, bytes);
    if (webBluetoothDevice) return printBluetooth(webBluetoothDevice, bytes);
    throw new Error('No hay impresora conectada.');
  };

  // Apply branding palette to CSS variables and inject dynamic styles
  React.useEffect(() => {
    const validHex = (v?: string) => (v && /^#[0-9a-fA-F]{6}$/.test(v)) ? v : null;
    const dark    = validHex(branding.darkColor)    || '#1e1b4b';
    const primary = validHex(branding.primaryColor) || '#6366f1';
    const accent  = validHex(branding.accentColor)  || '#a855f7';
    const root = document.documentElement;
    root.style.setProperty('--brand-dark', dark);
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-accent', accent);
    // Inject/update dynamic brand stylesheet
    let styleEl = document.getElementById('brand-styles') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'brand-styles';
      document.head.appendChild(styleEl);
    }
    const p10  = `color-mix(in srgb, ${primary} 10%, white)`;
    const p15  = `color-mix(in srgb, ${primary} 15%, white)`;
    const p20  = `color-mix(in srgb, ${primary} 20%, white)`;
    const p25  = `color-mix(in srgb, ${primary} 25%, transparent)`;
    const pDark = `color-mix(in srgb, ${primary} 80%, black)`;
    const a15  = `color-mix(in srgb, ${accent} 15%, white)`;
    const a30  = `color-mix(in srgb, ${accent} 30%, transparent)`;
    const dDark = `color-mix(in srgb, ${dark} 80%, black)`;
    styleEl.textContent = `
      /* ── Nav sidebar active items ── */
      #nav-pos.active-nav, #nav-products.active-nav, #nav-customers.active-nav,
      #nav-branches.active-nav, #nav-suppliers.active-nav, #nav-invoicing.active-nav,
      #nav-history.active-nav, #nav-analytics.active-nav, #nav-settings.active-nav {
        background-color: ${p15} !important;
        color: ${primary} !important;
        border-color: ${p25} !important;
      }
      /* ── Primary text (prices, labels, links) ── */
      .text-indigo-600, .text-violet-600, .text-purple-600,
      .text-indigo-500, .text-violet-500, .text-purple-500,
      .text-indigo-400, .text-blue-600 { color: ${primary} !important; }
      .text-indigo-700, .text-violet-700, .text-purple-700 { color: ${pDark} !important; }
      /* ── Primary solid backgrounds (buttons, pills) ── */
      .bg-indigo-600, .bg-violet-600, .bg-purple-600 { background-color: ${primary} !important; }
      .bg-indigo-700, .bg-violet-700 { background-color: ${pDark} !important; }
      /* ── Light tint backgrounds ── */
      .bg-indigo-50, .bg-violet-50, .bg-purple-50 { background-color: ${p10} !important; }
      .bg-indigo-100, .bg-violet-100, .bg-purple-100 { background-color: ${p20} !important; }
      /* ── Borders ── */
      .border-indigo-500, .border-violet-500, .border-purple-500 { border-color: ${primary} !important; }
      .border-indigo-600, .border-violet-600, .border-purple-600 { border-color: ${primary} !important; }
      .border-indigo-100, .border-violet-100, .border-purple-100 { border-color: ${p15} !important; }
      .border-indigo-200, .border-violet-200, .border-purple-200 { border-color: ${p20} !important; }
      /* ── Hover pseudo-classes ── */
      .hover\\:bg-indigo-600:hover, .hover\\:bg-violet-600:hover, .hover\\:bg-purple-50:hover { background-color: ${primary} !important; }
      .hover\\:bg-indigo-700:hover, .hover\\:bg-violet-700:hover { background-color: ${pDark} !important; }
      .hover\\:text-indigo-600:hover, .hover\\:text-violet-600:hover { color: ${primary} !important; }
      /* ── Group-hover (product card add button) ── */
      .group:hover .group-hover\\:text-indigo-600 { color: ${primary} !important; }
      .group:hover .group-hover\\:bg-indigo-50 { background-color: ${p10} !important; }
      .group:hover .group-hover\\:border-indigo-100 { border-color: ${p15} !important; }
      /* ── Header overlays (semi-transparent on dark banner) ── */
      .bg-indigo-900\/40, .bg-purple-950\/60 { background-color: color-mix(in srgb, ${dark} 45%, transparent) !important; }
      .bg-indigo-900\/60 { background-color: color-mix(in srgb, ${dark} 60%, transparent) !important; }
      .bg-indigo-900\/80 { background-color: color-mix(in srgb, ${dark} 80%, transparent) !important; }
      .bg-indigo-800 { background-color: ${dDark} !important; }
      .bg-indigo-950 { background-color: color-mix(in srgb, ${dark} 90%, black) !important; }
      .border-indigo-700\/30 { border-color: color-mix(in srgb, ${primary} 30%, transparent) !important; }
      .border-indigo-700\/35 { border-color: color-mix(in srgb, ${primary} 35%, transparent) !important; }
      .border-indigo-700 { border-color: color-mix(in srgb, ${primary} 60%, black) !important; }
      .border-indigo-800, .border-purple-800\/30 { border-color: color-mix(in srgb, ${dark} 60%, black) !important; }
      .text-indigo-200, .text-purple-200 { color: color-mix(in srgb, ${primary} 40%, white) !important; }
      .text-indigo-300 { color: color-mix(in srgb, ${primary} 55%, white) !important; }
      .text-indigo-100 { color: color-mix(in srgb, ${primary} 25%, white) !important; }
      /* ── Focus rings ── */
      .ring-indigo-500, .focus\\:ring-indigo-500:focus { --tw-ring-color: ${primary} !important; }
      /* ── Custom classes ── */
      .btn-brand-primary { background-color: ${primary} !important; border-color: ${primary} !important; }
      .btn-brand-primary:hover { filter: brightness(1.12); }
    `;
  }, [branding]);

  // Inventory display preference (cards vs compact list), remembered across sessions.
  const [inventoryView, setInventoryView] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('logic_inventory_view') as 'grid' | 'list') || 'grid'
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [nowStr, setNowStr] = useState(() => {
    const d = new Date();
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  });
  React.useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowStr(d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
    };
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  
  // Authentication state
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Employee-credential login form (used by the mandatory login gate — see the early
  // return before the main JSX)
  const [authCompanyId, setAuthCompanyId] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [isSignInLoading, setIsSignInLoading] = useState(false);
  // Shown inline in the login form instead of alert(): alert() blocks JS execution until
  // dismissed, and on some Android WebView builds that native dialog doesn't render (or renders
  // somewhere the user never sees) — leaving the button stuck on "Verificando..." forever with
  // no visible error, even though the code already knew exactly what went wrong.
  const [authError, setAuthError] = useState('');

  // Credential-employee bootstrap ("Conectando al sistema..." waiting screen, see the users/{uid}
  // sync effect below): true once every automatic retry has been exhausted without successfully
  // rebuilding the profile, so the waiting screen can show a real error + "Reintentar" button
  // instead of spinning forever. bootstrapRetryTrigger lets that button re-run the whole sync
  // effect (it's in the effect's dependency array) without needing the user to sign out and back in.
  const [credentialBootstrapFailed, setCredentialBootstrapFailed] = useState(false);
  const [bootstrapRetryTrigger, setBootstrapRetryTrigger] = useState(0);

  // Shared by the two-field form and the kiosk PIN pad — both resolve to the
  // same virtual-email account (mirrors CompanySettingsView.handleCreateCredentialEmployee).
  // No zero-padding: employee numbers must be 6+ real digits, set at account creation time.
  const signInWithEmployeeCredentials = async (companyIdRaw: string, employeeNumberRaw: string) => {
    const cleanCompanyId = companyIdRaw.trim().toLowerCase();
    const cleanUsername = employeeNumberRaw.trim();
    const virtualEmail = `${cleanCompanyId}_${cleanUsername}@logicpos.com`;
    await signInWithEmailAndPassword(auth, virtualEmail, cleanUsername);
  };

  const describeSignInError = (err: any): string => {
    if (err.code === 'auth/operation-not-allowed' || (err.message && err.message.includes('operation-not-allowed'))) {
      return "El método de inicio de sesión por Correo/Contraseña está deshabilitado en tu Firebase Console.\n\nPara habilitarlo:\n1. Entra a console.firebase.google.com y ve a tu proyecto.\n2. Ve a 'Authentication' -> pestaña 'Sign-in method'.\n3. Habilita y guarda el proveedor 'Correo electrónico/contraseña'.";
    }
    if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      return "El ID de comercio, usuario o contraseña son incorrectos.";
    }
    return "Credenciales incorrectas o problemas de conexión.";
  };

  const handleCredentialSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!authCompanyId.trim() || !authUsername.trim()) {
      setAuthError("Por favor completa el Código de Comercio y tu Número de Empleado.");
      return;
    }

    setIsSignInLoading(true);
    try {
      await signInWithEmployeeCredentials(authCompanyId, authUsername);

      // Clean local Form State
      setAuthCompanyId('');
      setAuthUsername('');
    } catch (err: any) {
      console.error("Error signing in with employee credentials:", err);
      setAuthError(describeSignInError(err));
    } finally {
      setIsSignInLoading(false);
    }
  };

  // Kiosk binding (Fase 3): once an owner/admin sets this device's company from
  // CompanySettingsView, the login gate below skips the two-field form and shows
  // the PIN pad pre-bound to that company — only the employee number is needed.
  const [kioskCompanyId, setKioskCompanyId] = useState<string | null>(
    () => localStorage.getItem(KIOSK_COMPANY_STORAGE_KEY)
  );
  const [isKioskSignInLoading, setIsKioskSignInLoading] = useState(false);
  const [kioskSignInError, setKioskSignInError] = useState('');

  const handleBindKiosk = (companyId: string) => {
    localStorage.setItem(KIOSK_COMPANY_STORAGE_KEY, companyId);
    setKioskCompanyId(companyId);
  };

  const handleUnbindKiosk = () => {
    localStorage.removeItem(KIOSK_COMPANY_STORAGE_KEY);
    setKioskCompanyId(null);
    setKioskSignInError('');
  };

  const handleKioskPinSubmit = async (employeeNumber: string) => {
    if (!kioskCompanyId) return;
    setKioskSignInError('');
    setIsKioskSignInLoading(true);
    try {
      await signInWithEmployeeCredentials(kioskCompanyId, employeeNumber);
    } catch (err: any) {
      console.error("Error signing in with kiosk PIN:", err);
      setKioskSignInError(describeSignInError(err));
    } finally {
      setIsKioskSignInLoading(false);
    }
  };

  // Multi-Company States
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [userCompanies, setUserCompanies] = useState<{ [id: string]: { id: string; name: string; role: 'owner' | 'master_admin' | 'admin' | 'employee' | 'mesero' } }>({});
  const [currentUserMember, setCurrentUserMember] = useState<any | null>(null);
  const [dashboardSelectedTable, setDashboardSelectedTable] = useState<Table | null>(null);
  const [dashboardIsManagingOrder, setDashboardIsManagingOrder] = useState<boolean>(false);

  // Hard States
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  // Restaurant mode: company-wide (not just the active branch), read by AuditView to cross-
  // reference sales/orders/cash movements across the whole company. Separate from the
  // single-branch `cashRegister` below (used to actually operate the till).
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [allCashRegisters, setAllCashRegisters] = useState<{ [branchId: string]: CashRegister }>({});
  const [selectedBranchId, setSelectedBranchId] = useState<string>('b1');

  // Prompts and custom Modals (bypassing restricted iframe prompt/confirms)
  const [paymentPrompt, setPaymentPrompt] = useState<{customerId: string, customerName: string, unpaidBalance: number} | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'pending' | 'completed' | 'all'>('all');
  const [newCatPrompt, setNewCatPrompt] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [editInitialCashPrompt, setEditInitialCashPrompt] = useState(false);
  const [newInitialCash, setNewInitialCash] = useState('');

  
  const [cashRegister, setCashRegister] = useState<CashRegister>({
    isOpen: true,
    initialCash: 2000,
    currentCash: 2000,
    transactions: [{ type: 'Ingreso', amount: 2000, description: 'Apertura de Caja', time: new Date().toLocaleTimeString() }]
  });

  // Ad-hoc Custom Categories state
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('logic_custom_categories');
    return saved ? JSON.parse(saved) : [];
  });
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Cash Register Dialog / Alert States
  const [showOvernightWarning, setShowOvernightWarning] = useState(false);
  const [warningOperationalDate, setWarningOperationalDate] = useState('');
  
  const [isCorteModalOpen, setIsCorteModalOpen] = useState(false);
  const [realCashInput, setRealCashInput] = useState('');
  
  const [isOpeningCajaModalOpen, setIsOpeningCajaModalOpen] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('2000');
  const [showClosedCajaBanner, setShowClosedCajaBanner] = useState(true);

  // Distribution branch state
  const [isDistModalOpen, setIsDistModalOpen] = useState(false);
  const [distSourceBranchId, setDistSourceBranchId] = useState('');
  const [distDestBranchId, setDistDestBranchId] = useState('');
  const [distQuantities, setDistQuantities] = useState<{[prodId: string]: number}>({});

  const activeCompanyRole = user && activeCompanyId ? (userCompanies[activeCompanyId]?.role || 'employee') : 'owner';
  // Mirrors firestore.rules isOwnerOrAdmin() — refunds/voids require this client-side too
  const isOwnerOrAdminRole = activeCompanyRole === 'owner' || activeCompanyRole === 'master_admin' || activeCompanyRole === 'admin';
  // Cajero's base Inventario access is view-only (no editar/eliminar/surtir/transferir) —
  // "Asignar Tareas" permissions grant these as extra capabilities on top of that baseline.
  const canEditProducts = isOwnerOrAdminRole || !!currentUserMember?.permissions?.includes('products_edit');
  const canTransferStock = isOwnerOrAdminRole || !!currentUserMember?.permissions?.includes('stock_transfer');

  // True when the logged-in user authenticated with an employee code (virtual email), not Google
  const isCredentialEmployee = Boolean(user?.email?.includes('_') && user?.email?.endsWith('@logicpos.com'));

  // Handler to Create a new Company inside cloud & bootstrap default entities
  const handleCreateCompany = async (companyName: string) => {
    if (!companyName.trim()) return;
    if (!user) return;

    try {
      const companyId = 'comp_' + Math.floor(Math.random() * 900000 + 100000);
      const newCompany: Company = {
        id: companyId,
        name: companyName,
        ownerId: user.uid,
        invitationCode: 'INV-' + Math.floor(Math.random() * 90000 + 10000),
        createdAt: new Date().toISOString(),
        // This repo is the restaurant line — new companies default to 'restaurante'. The
        // field stays generic so the same codebase can still serve retail companies.
        businessType: 'restaurante'
      };

      // 1. Save company registration document
      await setDoc(doc(db, 'companies', companyId), newCompany);

      // 2. Add creator as owner member
      await setDoc(doc(db, 'companies', companyId, 'members', user.uid), {
        userId: user.uid,
        name: user.displayName || 'Propietario',
        email: user.email || '',
        role: 'owner',
        joinedAt: new Date().toISOString()
      });

      // 3. No branches exist yet at this point, so there's nothing to pre-create a cash
      // register for — each branch gets its own companies/{id}/cashRegisters/{branchId}
      // doc lazily, the first time someone opens its register (see writeCashRegisterForBranch).

      // 4. Update parent profile
      const updatedCompanies = {
        ...userCompanies,
        [companyId]: {
          id: companyId,
          name: companyName,
          role: 'owner' as const
        }
      };

      await setDoc(doc(db, 'users', user.uid), {
        companies: updatedCompanies,
        activeCompanyId: companyId
      }, { merge: true });

      localStorage.setItem(`logic_active_company_${user.uid}`, companyId);
      setActiveCompanyId(companyId);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `companies_creation`);
    }
  };

  const handleRestoreCompanyData = async (backupData: any, onProgress: (msg: string) => void) => {
    if (!activeCompanyId) throw new Error("No hay un comercio seleccionado.");
    if (!backupData || typeof backupData !== 'object') {
      throw new Error("El archivo de respaldo no es válido o está corrupto.");
    }
    if (!Array.isArray(backupData.products) && backupData.products !== undefined) {
      throw new Error("El campo 'products' del respaldo no tiene el formato correcto.");
    }

    onProgress("Inicializando restauración...");

    // Products
    if (backupData.products && backupData.products.length > 0) {
      for (let i = 0; i < backupData.products.length; i++) {
        const p = backupData.products[i];
        onProgress(`Restaurando productos: ${i + 1} de ${backupData.products.length}...`);
        await setDoc(doc(db, 'companies', activeCompanyId, 'products', p.id), p);
      }
    }

    // Sales
    if (backupData.sales && backupData.sales.length > 0) {
      for (let i = 0; i < backupData.sales.length; i++) {
        const s = backupData.sales[i];
        onProgress(`Restaurando historial de ventas: ${i + 1} de ${backupData.sales.length}...`);
        await setDoc(doc(db, 'companies', activeCompanyId, 'sales', s.id), s);
      }
    }

    // Customers
    if (backupData.customers && backupData.customers.length > 0) {
      for (let i = 0; i < backupData.customers.length; i++) {
        const c = backupData.customers[i];
        onProgress(`Restaurando catálogo de clientes: ${i + 1} de ${backupData.customers.length}...`);
        await setDoc(doc(db, 'companies', activeCompanyId, 'customers', c.id), c);
      }
    }

    // Branches
    if (backupData.branches && backupData.branches.length > 0) {
      for (let i = 0; i < backupData.branches.length; i++) {
        const b = backupData.branches[i];
        onProgress(`Restaurando sucursales: ${i + 1} de ${backupData.branches.length}...`);
        await setDoc(doc(db, 'companies', activeCompanyId, 'branches', b.id), b);
      }
    }

    // Suppliers
    if (backupData.suppliers && backupData.suppliers.length > 0) {
      for (let i = 0; i < backupData.suppliers.length; i++) {
        const sup = backupData.suppliers[i];
        onProgress(`Restaurando proveedores: ${i + 1} de ${backupData.suppliers.length}...`);
        await setDoc(doc(db, 'companies', activeCompanyId, 'suppliers', sup.id), sup);
      }
    }

    // Custom Categories
    if (Array.isArray(backupData.customCategories)) {
      onProgress("Restaurando categorías personalizadas...");
      localStorage.setItem('logic_custom_categories', JSON.stringify(backupData.customCategories));
      setCustomCategories(backupData.customCategories);
    }

    // Branding settings
    if (backupData.branding && typeof backupData.branding === 'object' && Object.keys(backupData.branding).length > 0) {
      onProgress("Restaurando apariencia del comercio...");
      await setDoc(doc(db, 'companies', activeCompanyId, 'settings', 'branding'), backupData.branding, { merge: true });
    }

    onProgress("¡Completado!");
  };

  // Handler to Join an existing Company using an Active invitation Code
  const handleJoinCompanyWithCode = async (code: string) => {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    if (!user) return;
    // Credential employees (employee-number accounts) cannot use invite codes
    if (isCredentialEmployee) {
      alert("Los códigos de invitación son exclusivos para cuentas de Google. Las cuentas de empleado son creadas por el administrador desde el panel de Equipo.");
      return;
    }

    try {
      // Fetch global invitation code doc
      const inviteDocSnap = await getDoc(doc(db, 'invitationCodes', cleanCode));
      if (!inviteDocSnap.exists()) {
        alert("El código de invitación ingresado es incorrecto, ya ha expirado o fue retirado.");
        return;
      }

      const inviteData = inviteDocSnap.data();
      const compId = inviteData.companyId;
      const compName = inviteData.companyName || "Empresa Invitada";
      const userRole = inviteData.role || "employee";
      const usageType = inviteData.usageType || 'multiple';

      // Write user as employee member of company subcollection
      // `inviteCode` lets Firestore rules verify this join is backed by a real,
      // company-matching invitation (see firestore.rules: members.create)
      await setDoc(doc(db, 'companies', compId, 'members', user.uid), {
        userId: user.uid,
        name: user.displayName || 'Empleado',
        email: user.email || '',
        role: userRole,
        joinedAt: new Date().toISOString(),
        inviteCode: cleanCode
      });

      // Map to user accounts profile
      const updatedCompanies = {
        ...userCompanies,
        [compId]: {
          id: compId,
          name: compName,
          role: userRole as any
        }
      };

      await setDoc(doc(db, 'users', user.uid), {
        companies: updatedCompanies,
        activeCompanyId: compId
      }, { merge: true });

      // If single use, delete invitation record from Firestore
      if (usageType === 'single') {
        try {
          await deleteDoc(doc(db, 'invitationCodes', cleanCode));
          await updateDoc(doc(db, 'companies', compId), {
            invitationCode: null
          });
        } catch (errDelete) {
          console.warn("Could not auto-delete single use invite code:", errDelete);
        }
      }

      localStorage.setItem(`logic_active_company_${user.uid}`, compId);
      setActiveCompanyId(compId);
      alert(`Te has unido exitosamente a "${compName}" con rol de ${userRole === 'admin' ? 'Administrador' : 'Empleado'}.${usageType === 'single' ? ' (El enlace temporal de un solo uso fue desactivado)' : ''}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `invitation_code_join`);
    }
  };

  // Delete an existing company (Requires owner role)
  // Deletes every document in a company subcollection, chunked into batches of at most
  // 450 ops to stay safely under Firestore's 500-write batch limit.
  const deleteAllDocsInSubcollection = async (companyId: string, subcollection: string) => {
    const snap = await getDocs(collection(db, 'companies', companyId, subcollection));
    const docRefs = snap.docs.map(d => d.ref);
    for (let i = 0; i < docRefs.length; i += 450) {
      const batch = writeBatch(db);
      docRefs.slice(i, i + 450).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
  };

  const handleDeleteCompany = async (companyId: string) => {
    if (!user) return;
    try {
      // 1. Delete the root company doc first, while the caller's own owner membership
      // doc still exists (companies.delete requires isOwner(), which reads that doc).
      await deleteDoc(doc(db, 'companies', companyId));

      // 2. Delete every subcollection doc. `members` must go last: every other
      // subcollection's delete rule checks isMemberOfCompany/isOwnerOrAdmin, which reads
      // the requester's own members/{uid} doc — deleting it earlier would lock the rest
      // of this cleanup out partway through. Leaving stray subcollection docs behind
      // (as the old root-doc-only delete did) meant former members kept full read/write
      // access to "deleted" company data forever, since isMemberOfCompany never checks
      // whether the parent companies/{companyId} doc still exists.
      for (const sub of ['products', 'customers', 'branches', 'suppliers', 'sales', 'cashRegisters', 'stockMovements', 'settings']) {
        await deleteAllDocsInSubcollection(companyId, sub);
      }
      await deleteAllDocsInSubcollection(companyId, 'members');

      // 3. Remove company from user's companies profile mapping
      const updatedCompanies = { ...userCompanies };
      delete updatedCompanies[companyId];

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        companies: updatedCompanies,
        ...(activeCompanyId === companyId ? { activeCompanyId: null } : {})
      });

      // Clear local storage key choice
      localStorage.removeItem(`logic_active_company_${user.uid}`);
      if (activeCompanyId === companyId) {
        setActiveCompanyId(null);
      }
      alert("La empresa ha sido eliminada permanentemente en la nube.");
    } catch (err) {
      console.error("Error deleting company:", err);
      alert("Error al intentar eliminar la empresa. Por favor confirma tus privilegios de Propietario o red.");
    }
  };

  // Auth Status listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
      setIsAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Listen for direct URL invitation links (e.g. ?invite=INV-XXXXX)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('invite');
    if (inviteCode) {
      sessionStorage.setItem('pending_invite_code', inviteCode.trim().toUpperCase());
      // Clean URL parameters immediately to keep clean slate
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Process pending invitation code once user becomes authenticated
  useEffect(() => {
    if (user && !isAuthLoading) {
      const pendingCode = sessionStorage.getItem('pending_invite_code');
      if (pendingCode) {
        sessionStorage.removeItem('pending_invite_code');
        handleJoinCompanyWithCode(pendingCode);
      }
    }
  }, [user, isAuthLoading]);

  // Multi-Company User registration and listings synchronization listeners
  useEffect(() => {
    if (!user) {
      setActiveCompanyId(null);
      setUserCompanies({});
      return;
    }

    // Restore activeCompanyId immediately from localStorage so Firestore listeners
    // start right away and avoid a blank-data flash while the users doc snapshot resolves
    const quickRestore = localStorage.getItem(`logic_active_company_${user.uid}`);
    if (quickRestore) setActiveCompanyId(quickRestore);

    const isVirtualEmployee = !!(user.email && user.email.includes('_') && user.email.endsWith('@logicpos.com'));
    let parsedCompanyId: string | null = null;
    if (isVirtualEmployee) {
      const emailLocal = user.email!.split('@')[0];
      const firstUnderscore = emailLocal.indexOf('_');
      const secondUnderscore = emailLocal.indexOf('_', firstUnderscore + 1);
      parsedCompanyId = secondUnderscore !== -1 ? emailLocal.substring(0, secondUnderscore) : null;
    }

    // Bootstraps (or rebuilds) a credential (virtual-email) employee's users/{uid} doc from
    // their company member record. Called both when the doc doesn't exist yet (first login) and
    // when it exists but was left with an empty `companies` map (a stuck/"poisoned" profile from
    // a permission-denied race — firestore.rules' isMemberOfCompany() gates the member-doc read
    // on that exact doc's own existence, so reading it right after an Owner creates the account,
    // before it's visible, throws permission-denied rather than a clean "not found"). That second
    // case used to be a permanent dead end, since a doc that already exists never re-triggers the
    // "doesn't exist" branch again, not even after signing out and back in. Retries several times
    // over ~10s to ride out brief connectivity/propagation hiccups before finally giving up and
    // letting the waiting screen show a real error + "Reintentar" button instead of spinning forever.
    const bootstrapCredentialEmployee = async (attempt: number) => {
      if (!parsedCompanyId) { setCredentialBootstrapFailed(true); return; }
      if (attempt === 0) setCredentialBootstrapFailed(false);
      try {
        const memberSnap = await getDoc(doc(db, 'companies', parsedCompanyId, 'members', user.uid));
        if (!memberSnap.exists()) throw new Error('member-not-visible-yet');
        const mData = memberSnap.data();

        let compName = 'Mi Empresa';
        try {
          const compSnap = await getDoc(doc(db, 'companies', parsedCompanyId));
          if (compSnap.exists()) compName = compSnap.data().name || compName;
        } catch {
          // Company name lookup failing isn't fatal — fall back to the generic label.
        }

        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email || '',
          name: mData.name || 'Empleado',
          createdAt: new Date().toISOString(),
          companies: {
            [parsedCompanyId]: {
              id: parsedCompanyId,
              name: compName,
              role: mData.role || 'employee'
            }
          },
          activeCompanyId: parsedCompanyId
        });
      } catch (err) {
        if (attempt < 4) {
          setTimeout(() => bootstrapCredentialEmployee(attempt + 1), 2500);
        } else {
          setCredentialBootstrapFailed(true);
        }
      }
    };

    const unsubUser = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const companies = data.companies || {};
        const keys = Object.keys(companies);

        if (keys.length === 0 && isVirtualEmployee) {
          // Stuck/poisoned credential-employee profile — self-heal instead of leaving it
          // stranded (see comment on bootstrapCredentialEmployee above).
          bootstrapCredentialEmployee(0);
          return;
        }

        setUserCompanies(companies);

        const savedActiveCompanyId = localStorage.getItem(`logic_active_company_${user.uid}`);
        const cloudActiveCompanyId = data.activeCompanyId;

        if (cloudActiveCompanyId && companies[cloudActiveCompanyId]) {
          setActiveCompanyId(cloudActiveCompanyId);
        } else if (savedActiveCompanyId && companies[savedActiveCompanyId]) {
          setActiveCompanyId(savedActiveCompanyId);
        } else if (keys.length > 0) {
          setActiveCompanyId(keys[0]);
        } else {
          setActiveCompanyId(null);
        }
      } else if (isVirtualEmployee) {
        bootstrapCredentialEmployee(0);
      } else {
        // Genuine new signup (Google account that's never created/joined a company) — this IS
        // the correct steady state, not a failure: seeds an empty companies map so they land on
        // "create your first company" instead of the employee waiting screen.
        setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email || '',
          name: user.displayName || 'Comerciante',
          createdAt: new Date().toISOString(),
          companies: {}
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
        setActiveCompanyId(null);
        setUserCompanies({});
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubUser();
  }, [user, bootstrapRetryTrigger]);

  // Self-healing role sync to preserve security and sync changes automatically across active teams
  useEffect(() => {
    if (!user || !activeCompanyId || !userCompanies[activeCompanyId]) {
      setCurrentUserMember(null);
      return;
    }

    const unsubMemberSelf = onSnapshot(doc(db, 'companies', activeCompanyId, 'members', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const memberData = snapshot.data();
        setCurrentUserMember(memberData);

        const realRole = memberData.role;
        const currentRoleInUserDoc = userCompanies[activeCompanyId]?.role;
        
        if (realRole && realRole !== currentRoleInUserDoc) {
          console.log(`Self-healing company role sync: ${currentRoleInUserDoc} -> ${realRole}`);
          const updatedCompanies = {
            ...userCompanies,
            [activeCompanyId]: {
              ...userCompanies[activeCompanyId],
              role: realRole
            }
          };
          updateDoc(doc(db, 'users', user.uid), {
            companies: updatedCompanies
          }).catch(err => {
            console.error("Error healing company role:", err);
          });
        }
      } else {
        setCurrentUserMember(null);
      }
    }, (error) => {
      console.warn("User has not synced member record yet:", error.message);
    });

    return () => unsubMemberSelf();
  }, [user, activeCompanyId, userCompanies]);

  // Lock the branch selector for employees, and self-heal it for everyone else. The initial
  // state is the placeholder 'b1' (see useState above), which never matches a real branch —
  // ids are always generated as 'B-XXXX' (handleSaveBranch) — so a brand-new company that
  // registers its first branch and starts selling right away, without ever touching the
  // switcher, would otherwise stamp every sale/stock movement with 'b1' forever. Same
  // placeholder-recovery applies to a stale id left in `logic_active_branch` (localStorage,
  // not scoped per company) from a previously active company or a since-deleted branch.
  useEffect(() => {
    if (!user || !activeCompanyId) return;

    // Check if the current user has branch restrictions (employee or mesero)
    const isBranchRestricted = activeCompanyRole === 'employee' || activeCompanyRole === 'mesero';
    if (isBranchRestricted && currentUserMember?.assignedBranchId) {
      if (selectedBranchId !== currentUserMember.assignedBranchId) {
        setSelectedBranchId(currentUserMember.assignedBranchId);
        localStorage.setItem('logic_active_branch', currentUserMember.assignedBranchId);
      }
      return;
    }

    if (branches.length > 0 && !branches.some(b => b.id === selectedBranchId)) {
      const fallback = branches.find(b => b.isMatriz) || branches[0];
      setSelectedBranchId(fallback.id);
      localStorage.setItem('logic_active_branch', fallback.id);
    }
  }, [currentUserMember, activeCompanyRole, selectedBranchId, activeCompanyId, user, branches]);

  // Sync state from Firestore
  useEffect(() => {
    if (!user) {
      // Logged out: the whole app is gated behind login (see the early return before the
      // main JSX), so nothing here is ever visible — but we still clear state rather than
      // loading the old "modo local" fallback from localStorage. That fallback used to read
      // back `logic_products`/`logic_sales`/etc., which are the SAME keys saveAllData() mirrors
      // on every authenticated write as an offline-durability cache — so a logged-out session
      // on a device that had previously been signed in could load and briefly hold real
      // production data in memory. Clearing avoids that entirely.
      setBranding({});
      setProducts([]);
      setCustomers([]);
      setBranches([]);
      setSuppliers([]);
      setSales([]);
      return;
    }

    if (!activeCompanyId) {
      // Clean display till company is picked
      setActiveCompany(null);
      setProducts([]);
      setCustomers([]);
      setBranches([]);
      setSuppliers([]);
      setSales([]);
      setStockMovements([]);
      setBranding({});
      return;
    }

    // Connect real-time Firestore synchronization feeds
    const compId = activeCompanyId;

    const unsubCompanyDoc = onSnapshot(doc(db, 'companies', compId), (snapshot) => {
      if (snapshot.exists()) {
        setActiveCompany(snapshot.data() as Company);
      } else {
        setActiveCompany(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `companies/${compId}`);
    });

    const unsubProducts = onSnapshot(collection(db, 'companies', compId, 'products'), (snapshot) => {
      const list: Product[] = [];
      snapshot.forEach(d => {
        list.push(d.data() as Product);
      });
      setProducts(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/products`);
    });

    const unsubCustomers = onSnapshot(collection(db, 'companies', compId, 'customers'), (snapshot) => {
      const list: Customer[] = [];
      snapshot.forEach(d => {
        list.push(d.data() as Customer);
      });
      setCustomers(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/customers`);
    });

    const unsubBranches = onSnapshot(collection(db, 'companies', compId, 'branches'), (snapshot) => {
      const list: Branch[] = [];
      snapshot.forEach(d => {
        list.push(d.data() as Branch);
      });
      setBranches(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/branches`);
    });

    const unsubSuppliers = onSnapshot(collection(db, 'companies', compId, 'suppliers'), (snapshot) => {
      const list: Supplier[] = [];
      snapshot.forEach(d => {
        list.push(d.data() as Supplier);
      });
      setSuppliers(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/suppliers`);
    });

    const unsubMembers = onSnapshot(collection(db, 'companies', compId, 'members'), (snapshot) => {
      const list: Member[] = [];
      snapshot.forEach(d => {
        list.push(d.data() as Member);
      });
      setMembers(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/members`);
    });

    // Restaurant mode: open/closed tabs, read company-wide for the audit panel (Fase 2b)
    // and for the gastronomic flow (Fase 4). No writes happen yet — orders start appearing
    // once Fase 4 ships the table/comanda UI.
    const unsubOrders = onSnapshot(collection(db, 'companies', compId, 'orders'), (snapshot) => {
      const list: Order[] = [];
      snapshot.forEach(d => list.push(d.data() as Order));
      list.sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''));
      setOrders(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/orders`);
    });

    const unsubTables = onSnapshot(collection(db, 'companies', compId, 'tables'), (snapshot) => {
      const list: Table[] = [];
      snapshot.forEach(d => list.push(d.data() as Table));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setTables(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/tables`);
    });

    // Company-wide cash register log (every branch, not just the active one) — separate
    // from the single-branch `unsubCash` below, which drives the live till operations.
    // Existing rules already let any member list/get the whole cashRegisters collection.
    const unsubAllCashRegisters = onSnapshot(collection(db, 'companies', compId, 'cashRegisters'), (snapshot) => {
      const map: { [branchId: string]: CashRegister } = {};
      snapshot.forEach(d => { map[d.id] = d.data() as CashRegister; });
      setAllCashRegisters(map);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `companies/${compId}/cashRegisters`);
    });

    const unsubBranding = onSnapshot(doc(db, 'companies', compId, 'settings', 'branding'), (snapshot) => {
      if (snapshot.exists()) {
        setBranding(snapshot.data() as Branding);
      } else {
        setBranding({});
      }
    }, (err) => {
      // Log permission errors without clearing branding (rules may still be propagating)
      console.error('[Branding] onSnapshot error:', err.code, err.message);
    });

    const unsubPrintConfig = onSnapshot(doc(db, 'companies', compId, 'settings', 'printConfig'), (snapshot) => {
      if (snapshot.exists()) {
        setPrintConfig({ ...DEFAULT_PRINT_CONFIG, ...snapshot.data() } as PrintConfig);
      } else {
        setPrintConfig(DEFAULT_PRINT_CONFIG);
      }
    }, (err) => {
      console.error('[PrintConfig] onSnapshot error:', err.code, err.message);
    });

    const savedActiveBranch = localStorage.getItem('logic_active_branch');
    if (savedActiveBranch) setSelectedBranchId(savedActiveBranch);

    return () => {
      unsubCompanyDoc();
      unsubProducts();
      unsubCustomers();
      unsubBranches();
      unsubSuppliers();
      unsubMembers();
      unsubOrders();
      unsubTables();
      unsubAllCashRegisters();
      unsubBranding();
      unsubPrintConfig();
    };
  }, [user, activeCompanyId]);

  // Cash register is scoped per-branch (companies/{id}/cashRegisters/{branchId}), not one
  // shared document — otherwise switching branches shows the same balance everywhere.
  // Kept in its own effect (instead of the big listener effect above) so it re-subscribes
  // only when the branch actually changes, not on every unrelated company-level update.
  useEffect(() => {
    if (!user || !activeCompanyId || !selectedBranchId) return;
    const compId = activeCompanyId;
    const branchId = selectedBranchId;

    const unsubCash = onSnapshot(doc(db, 'companies', compId, 'cashRegisters', branchId), (snapshot) => {
      if (snapshot.exists()) {
        // Defaults first, then the doc's own fields — a register doc can exist with only
        // currentCash/transactions if it was auto-created by a sale/transfer delta before
        // anyone ever pressed "abrir caja" (isOpen/initialCash would otherwise be missing).
        setCashRegister({ isOpen: false, initialCash: 0, currentCash: 0, transactions: [], ...snapshot.data() } as CashRegister);
      } else {
        // No register doc yet for this branch (brand-new branch, never opened) — show a
        // clean closed state instead of leaking whatever the previous branch had cached.
        setCashRegister({ isOpen: false, initialCash: 0, currentCash: 0, transactions: [] });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `companies/${compId}/cashRegisters/${branchId}`);
    });

    return () => unsubCash();
  }, [user, activeCompanyId, selectedBranchId]);

  // Sales and stock movements are the two largest, fastest-growing collections in the company,
  // so — like cashRegister above — they're scoped to the active branch's own `branchId` instead
  // of loading every branch's full history into every session (that used to be the single
  // biggest driver of Firestore read-quota consumption on the free plan). New sales/movements
  // always carry a real branchId; the few screens that genuinely need every branch at once
  // (AuditView, Facturación, Sucursales revenue cards, the CSV dashboard export, and the Drive
  // backup) fetch those separately with a one-off getDocs query instead of depending on this
  // live, branch-scoped stream.
  useEffect(() => {
    if (!user || !activeCompanyId || !selectedBranchId) return;
    const compId = activeCompanyId;
    const branchId = selectedBranchId;

    const unsubSales = onSnapshot(
      query(collection(db, 'companies', compId, 'sales'), where('branchId', '==', branchId)),
      (snapshot) => {
        const list: Sale[] = [];
        snapshot.forEach(d => list.push(d.data() as Sale));
        // `timestamp` is a locale display string (e.g. "30/6/2026, 4:55 p.m.") and isn't
        // reliably parseable by `new Date()` — sort by the numeric `createdAt` instead.
        // Older sales recorded before this field existed fall back to 0 (oldest last).
        const saleSortKey = (s: Sale) => s.createdAt ?? 0;
        list.sort((a, b) => saleSortKey(b) - saleSortKey(a));
        setSales(list);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `companies/${compId}/sales`);
      }
    );

    const unsubStockMovements = onSnapshot(
      query(collection(db, 'companies', compId, 'stockMovements'), where('branchId', '==', branchId)),
      (snapshot) => {
        const list: StockMovement[] = [];
        snapshot.forEach(d => list.push(d.data() as StockMovement));
        list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setStockMovements(list);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `companies/${compId}/stockMovements`);
      }
    );

    return () => {
      unsubSales();
      unsubStockMovements();
    };
  }, [user, activeCompanyId, selectedBranchId]);

  const getTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    if (cashRegister && cashRegister.isOpen) {
      const todayStr = getTodayDateString();
      if (!cashRegister.lastOperationalDate) {
        const updated = { ...cashRegister, lastOperationalDate: todayStr };
        setCashRegister(updated);
        localStorage.setItem('logic_cash', JSON.stringify(updated));
      } else if (cashRegister.lastOperationalDate !== todayStr) {
        setWarningOperationalDate(cashRegister.lastOperationalDate);
        setShowOvernightWarning(true);
      }
    }
  }, [cashRegister?.isOpen, cashRegister?.lastOperationalDate]);

  useEffect(() => {
    if (cashRegister && !cashRegister.isOpen) {
      setShowClosedCajaBanner(true);
    }
  }, [cashRegister?.isOpen]);

  // Opening/closing the register is a deliberate single-actor action (not a concurrent
  // delta like a sale), so it writes the whole branch-scoped doc directly instead of
  // going through applyCashDelta's increment/arrayUnion.
  const writeCashRegisterForBranch = async (branchId: string, newCash: CashRegister) => {
    setCashRegister(newCash);
    localStorage.setItem('logic_cash', JSON.stringify(newCash));
    if (user && activeCompanyId) {
      try {
        await setDoc(doc(db, 'companies', activeCompanyId, 'cashRegisters', branchId), sanitize(newCash));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `companies/${activeCompanyId}/cashRegisters/${branchId}`);
      }
    }
  };

  const handleCloseCaja = (realCashValue: number) => {
    const expected = cashRegister.currentCash;
    const diff = realCashValue - expected;
    const diffText = diff === 0
      ? 'Caja Cuadrada'
      : diff > 0
        ? `Sobrante de ${formatMXN(diff)}`
        : `Faltante de ${formatMXN(Math.abs(diff))}`;

    const newTx = {
      type: 'Egreso' as const,
      amount: Math.abs(diff),
      description: `Cierre de Caja - Real: ${formatMXN(realCashValue)} | Esp: ${formatMXN(expected)} (${diffText})`,
      time: new Date().toLocaleTimeString(),
      createdAt: Date.now()
    };

    const closedCash: CashRegister = {
      ...cashRegister,
      isOpen: false,
      currentCash: realCashValue,
      transactions: [...cashRegister.transactions, newTx]
    };

    writeCashRegisterForBranch(selectedBranchId, closedCash);
    setShowOvernightWarning(false);
    setIsCorteModalOpen(false);
    alert(`¡Caja cerrada correctamente! Total esperado: ${formatMXN(expected)} | Físico: ${formatMXN(realCashValue)} (${diffText}).`);

    setIsOpeningCajaModalOpen(true);
  };

  const handleOpenCaja = (initialCashValue: number) => {
    const todayStr = getTodayDateString();
    const newCash: CashRegister = {
      isOpen: true,
      initialCash: initialCashValue,
      currentCash: initialCashValue,
      lastOperationalDate: todayStr,
      transactions: [{
        type: 'Ingreso',
        amount: initialCashValue,
        description: `Apertura de Caja - Saldo Inicial: ${formatMXN(initialCashValue)}`,
        time: new Date().toLocaleTimeString(),
        createdAt: Date.now()
      }]
    };

    writeCashRegisterForBranch(selectedBranchId, newCash);
    setIsOpeningCajaModalOpen(false);
    alert(`¡Caja abierta correctamente con un saldo inicial de ${formatMXN(initialCashValue)}!`);
  };

  // Synchronize state functions across Cache & Firestore Cloud
  // Firestore rejects undefined values, safely sanitize objects before writing
  const sanitize = (obj: any): any => JSON.parse(JSON.stringify(obj));

  // Writes only the docs that actually changed (by id, reference-diffed against the
  // previous local arrays) instead of rewriting the entire catalogue/history on every
  // save. Two reasons this matters: a `writeBatch` hard-caps at 500 operations, so
  // rewriting the full sales history + catalogue on every single sale will eventually
  // fail outright once a branch accumulates that many records; and rewriting unrelated
  // documents needlessly multiplies Firestore billing for every action.
  // `currentCash`/`transactions` on the register are intentionally NOT diffed/written
  // here — concurrent terminals must go through applyCashDelta()'s atomic increment
  // instead of a last-write-wins overwrite. Pass the same `cashRegister` reference
  // through when a call site has no register change to make.
  const saveAllData = async (
    newProds: Product[],
    newCusts: Customer[],
    newSales: Sale[],
    newCash: CashRegister,
    newBranches: Branch[] = branches,
    newSuppliers: Supplier[] = suppliers
  ) => {
    // 1. Instantly update React state for latency-free rendering
    setProducts(newProds);
    setCustomers(newCusts);
    setSales(newSales);
    setCashRegister(newCash);
    setBranches(newBranches);
    setSuppliers(newSuppliers);

    // 2. Offline persistent local state fallback storage
    localStorage.setItem('logic_products', JSON.stringify(newProds));
    localStorage.setItem('logic_customers', JSON.stringify(newCusts));
    localStorage.setItem('logic_sales', JSON.stringify(newSales));
    localStorage.setItem('logic_cash', JSON.stringify(newCash));
    localStorage.setItem('logic_branches', JSON.stringify(newBranches));
    localStorage.setItem('logic_suppliers', JSON.stringify(newSuppliers));

    // 3. Save directly to Cloud if logged into Firebase Auth — only the docs that changed
    if (user && activeCompanyId) {
      const compId = activeCompanyId;
      try {
        const batch = writeBatch(db);
        let opCount = 0;

        const diffInto = (prevArr: { id: string }[], nextArr: { id: string }[], col: string) => {
          const prevById = new Map(prevArr.map(item => [item.id, item]));
          nextArr.forEach(item => {
            if (prevById.get(item.id) !== item) {
              batch.set(doc(db, 'companies', compId, col, item.id), sanitize(item));
              opCount++;
            }
          });
        };

        diffInto(products, newProds, 'products');
        diffInto(customers, newCusts, 'customers');
        diffInto(sales, newSales, 'sales');
        diffInto(branches, newBranches, 'branches');
        diffInto(suppliers, newSuppliers, 'suppliers');

        // Cash register writes do NOT go through this generic batch — it's scoped per
        // branch (companies/{id}/cashRegisters/{branchId}) and goes through either
        // applyCashDelta() (atomic deltas) or writeCashRegisterForBranch() (open/close).

        if (opCount > 0) {
          await batch.commit();
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `companies/${compId}/batch_sync`);
      }
    }
  };

  // Atomically applies a delta to a branch's cash register (currentCash + appended
  // transaction log entries) via Firestore's increment()/arrayUnion() field transforms.
  // Unlike saveAllData's overwrite, this is safe when multiple terminals post to the same
  // `cashRegisters/{branchId}` doc at the same time: each caller only describes the change
  // IT is contributing, so concurrent writers can never silently clobber each other's
  // totals. Uses setDoc+merge (not updateDoc) so it also works as an upsert — a branch
  // that has never had its register opened yet still gets a doc instead of erroring.
  const applyCashDelta = async (branchId: string, amountDelta: number, txEntries: CashRegister['transactions']) => {
    if (!user || !activeCompanyId || !branchId) return;
    try {
      await setDoc(doc(db, 'companies', activeCompanyId, 'cashRegisters', branchId), {
        currentCash: increment(amountDelta),
        transactions: arrayUnion(...txEntries.map(sanitize))
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/cashRegisters/${branchId}`);
    }
  };

  // Atomically applies a balance delta to a single customer (credit sales / "fiado" payments)
  const applyCustomerBalanceDelta = async (customerId: string, balanceDelta: number) => {
    if (!user || !activeCompanyId) return;
    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'customers', customerId), {
        unpaidBalance: increment(balanceDelta)
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/customers/${customerId}`);
    }
  };

  // Atomically applies stock deltas (global + per-branch) to one or more products in a
  // single Firestore transaction. Reads the live server documents right before writing,
  // so two terminals selling the last units of the same product at the same time can
  // never both succeed in selling more stock than actually exists / silently overwrite
  // each other's stock count (the failure mode of the old computed-from-stale-local-state
  // overwrite approach).
  const applyStockDeltas = async (deltas: { productId: string; branchId: string; qtyDelta: number }[]) => {
    if (!user || !activeCompanyId || deltas.length === 0) return;
    const compId = activeCompanyId;
    try {
      await runTransaction(db, async (tx) => {
        const productIds = Array.from(new Set(deltas.map(d => d.productId)));
        const refs = productIds.map(id => doc(db, 'companies', compId, 'products', id));
        const snaps = await Promise.all(refs.map(ref => tx.get(ref)));

        snaps.forEach((snap, idx) => {
          if (!snap.exists()) return;
          const data = snap.data() as Product;
          const productId = productIds[idx];
          const branchStocks = { ...(data.branchStocks || {}) };
          let stockTotal = data.stock;

          deltas.filter(d => d.productId === productId).forEach(d => {
            const currentBranchStock = branchStocks[d.branchId] !== undefined ? branchStocks[d.branchId] : data.stock;
            branchStocks[d.branchId] = Math.max(0, currentBranchStock + d.qtyDelta);
            stockTotal = Math.max(0, stockTotal + d.qtyDelta);
          });

          tx.update(refs[idx], { stock: stockTotal, branchStocks });
        });
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${compId}/products/stock_transaction`);
    }
  };

  // Writes append-only entries to the inventory audit log (surtidos / transfers). Each
  // caller passes the meaningful fields; id/user/timestamps are filled in here. Best-effort:
  // a logging failure must not block the actual stock change that already succeeded.
  const logStockMovements = async (
    entries: Pick<StockMovement, 'type' | 'productId' | 'productName' | 'quantity' | 'branchId' | 'branchName' | 'counterpartBranchId' | 'counterpartBranchName'>[]
  ) => {
    if (!user || !activeCompanyId || entries.length === 0) return;
    const compId = activeCompanyId;
    const now = Date.now();
    const userName = currentUserMember?.name || user.displayName || 'Sistema';
    const timestamp = new Date().toLocaleString();
    await Promise.all(entries.map((e, i) => {
      const id = `SM-${now}-${i}-${Math.floor(Math.random() * 10000)}`;
      return setDoc(doc(db, 'companies', compId, 'stockMovements', id), sanitize({ ...e, id, userName, timestamp, createdAt: now }))
        .catch(err => handleFirestoreError(err, OperationType.CREATE, `companies/${compId}/stockMovements/${id}`));
    }));
  };

  // Builds a Sale record and commits its side effects atomically (stock deltas, customer
  // credit balance, cash register entry) — the shared core behind closing a restaurant
  // table/order in ComandaView (pass `extra` to link the Sale back to its origin
  // `orders/{id}` — Fase 4b). Returns the created Sale so the caller can drive its own UI
  // (receipt modal, ticket print, etc).
  const buildAndCommitSale = (params: {
    items: SaleItem[];
    paymentMethod: Sale['paymentMethod'];
    branchId: string;
    discount?: number; // already-resolved amount, not a %
    taxAmount?: number; // already-resolved amount, not a %
    customerId?: string;
    customerName?: string;
    folio?: string;
    requiresInvoice?: boolean;
    extra?: { orderId?: string; tableId?: string; waiterName?: string };
  }): Sale => {
    const { items, paymentMethod, branchId, discount = 0, taxAmount = 0, customerId, customerName, folio, requiresInvoice, extra } = params;

    const subtotal = items.reduce((acc, item) => acc + item.salePrice * item.quantity, 0);
    const total = Math.max(0, subtotal - discount) + taxAmount;

    // 1. New Sale structure
    const newSale: Sale = {
      id: 'S-' + Math.floor(Math.random() * 900000 + 100000),
      items,
      subtotal,
      discount,
      tax: taxAmount,
      total,
      paymentMethod,
      customerId,
      customerName,
      timestamp: new Date().toLocaleString(),
      createdAt: Date.now(),
      status: 'Completed',
      branchId,
      folio,
      requiresInvoice,
      invoiceStatus: requiresInvoice ? 'pending' : undefined,
      // `currentUserMember.name` covers owner/encargado/cajero alike (all are member docs);
      // falls back to the Auth display name for the rare case the member doc hasn't synced yet.
      employeeName: currentUserMember?.name || user?.displayName || undefined,
      orderId: extra?.orderId,
      tableId: extra?.tableId,
      waiterName: extra?.waiterName
    };

    // 2. Adjust Product Inventory atomically (per-product Firestore transaction — see
    // applyStockDeltas). Avoids two terminals selling concurrently from silently
    // clobbering each other's stock count.
    applyStockDeltas(items.map(item => ({
      productId: item.productId,
      branchId,
      qtyDelta: -item.quantity
    })));

    // 3. Adjust Customer credit balance if credit payment (atomic increment)
    if (customerId && paymentMethod === 'Credit') {
      applyCustomerBalanceDelta(customerId, total);
    }

    // 4. Record Cash/Finance/Card/Transfer transaction in audit log (atomic — see applyCashDelta)
    const activeBranch = branches.find(b => b.id === branchId);
    const branchNameSuffix = activeBranch ? ` (${activeBranch.name})` : '';
    const paymentLabel = paymentMethod === 'Cash' ? 'Efectivo' : paymentMethod === 'Card' ? 'Tarjeta' : paymentMethod === 'Transfer' ? 'Transferencia' : 'Crédito';
    const descFolio = (paymentMethod === 'Card' || paymentMethod === 'Transfer') && folio ? ` [Folio: ${folio}]` : '';

    applyCashDelta(branchId, paymentMethod === 'Cash' ? total : 0, [{
      type: 'Venta',
      amount: total,
      description: `Venta ${newSale.id} - ${paymentLabel}${descFolio}${branchNameSuffix}`,
      time: new Date().toLocaleTimeString(),
      createdAt: Date.now(),
      branchId
    }]);

    // 5. Save the new sale record (only this single new doc gets written/diffed)
    saveAllData(products, customers, [newSale, ...sales], cashRegister);

    return newSale;
  };

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [lastCompletedSale, setLastCompletedSale] = useState<Sale | null>(null);
  const [lastReceivedAmount, setLastReceivedAmount] = useState<number>(0);

  const selectCategoriesList = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category || DEFAULT_PRODUCT_CATEGORY)));
    const defaults = ['Generales', 'Bebidas', 'Alimentos', 'Postres'];
    return Array.from(new Set([...defaults, ...customCategories, ...cats])).filter(c => c !== 'Todos');
  }, [products, customCategories]);

  const handleAddCategory = (newName: string) => {
    if (!newName.trim()) return;
    const clean = newName.trim();
    if (selectCategoriesList.includes(clean)) {
      alert("Esta categoría ya existe.");
      return;
    }
    const updated = [...customCategories, clean];
    setCustomCategories(updated);
    localStorage.setItem('logic_custom_categories', JSON.stringify(updated));
    setNewCategoryInput('');
    alert(`Categoría "${clean}" agregada con éxito.`);
  };

  const handleRenameCategory = async (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) return;
    const cleanNewName = newName.trim();

    const updatedProducts = products.map(p => {
      if ((p.category || DEFAULT_PRODUCT_CATEGORY) === oldName) {
        return { ...p, category: cleanNewName };
      }
      return p;
    });

    try {
      // saveAllData's diff-based batch only writes the products whose category actually changed
      await saveAllData(updatedProducts, customers, sales, cashRegister, branches, suppliers);
      alert(`La categoría "${oldName}" fue renombrada a "${cleanNewName}" en todos los productos.`);
    } catch (err) {
      console.error("Error renaming category:", err);
      alert("Error al intentar renombrar la categoría en la nube.");
    }
  };

  const handleSelectBranch = (branchId: string) => {
    setSelectedBranchId(branchId);
    localStorage.setItem('logic_active_branch', branchId);
  };

  // Prints a receipt via a hidden iframe instead of window.open(). The old approach opened
  // a new tab/window and self-closed it — in the Android WebView that spawned an in-app
  // view the user couldn't back out of (had to kill the app). A hidden iframe calls the
  // host's own print dialog (Android's system print → Bluetooth/WiFi printers or Save-as-PDF;
  // the OS handles printer selection), keeps the user in the app, and cleans itself up.
  const handlePrintReceipt = (sale: Sale, options?: { onSuccess?: () => void; onError?: (msg: string) => void }) => {
    const ticketBusinessName = branding.displayName || (activeCompanyId ? userCompanies[activeCompanyId]?.name : '') || 'Mi Comercio';
    const ticketTagline = branding.tagline || '';
    const ticketLogo = (printConfig.showLogo && branding.logoUrl) ? branding.logoUrl : '';
    const payLabel = sale.paymentMethod === 'Cash' ? 'Efectivo' : sale.paymentMethod === 'Card' ? 'Tarjeta' : sale.paymentMethod === 'Transfer' ? 'Transferencia' : 'Crédito/Fiado';

    const pw = printConfig.paperWidth;
    const isA4 = pw === 'A4';
    const pageSize = isA4 ? 'A4' : `${pw} auto`;
    const pageMargin = isA4 ? '1cm' : '0mm';
    const bodyMaxWidth = pw === '58mm' ? '220px' : pw === '80mm' ? '302px' : '640px';
    const bodyPadding = isA4 ? '20px 40px' : '10px 14px';
    const baseFontSize = pw === '58mm' ? '11px' : '12px';

    // Inner ticket markup, shared by every HTML-based path (native ReceiptPrinter full-doc,
    // and the web @media-print container). Kept separate from the <style> so the same markup
    // can be printed either as a standalone document or scoped inside the live page.
    const ticketBodyHtml = `
          <div class="header">
            ${ticketLogo ? `<img src="${ticketLogo}" class="logo" alt="logo">` : ''}
            <p class="biz-name">${ticketBusinessName}</p>
            ${ticketTagline ? `<p class="tagline">${ticketTagline}</p>` : ''}
            <p class="txn-id">Transacción: ${sale.id}</p>
          </div>
          <hr class="sep">
          <p><b>Fecha:</b> ${sale.timestamp}</p>
          <p><b>Método de Pago:</b> ${payLabel}</p>
          ${sale.customerName ? `<p><b>Cliente:</b> ${sale.customerName}</p>` : ''}
          ${sale.employeeName ? `<p><b>Atendido por:</b> ${sale.employeeName}</p>` : ''}
          <hr class="sep">
          <p class="bold">ARTÍCULOS:</p>
          ${sale.items.map(it => `
            <div class="row">
              <span>${it.quantity}x ${it.name}</span>
              <span>${formatMXN(it.salePrice * it.quantity)}</span>
            </div>
          `).join('')}
          <hr class="sep">
          <div class="row"><span>Subtotal:</span><span>${formatMXN(sale.subtotal)}</span></div>
          ${sale.discount > 0 ? `<div class="row"><span>Descuento:</span><span>-${formatMXN(sale.discount)}</span></div>` : ''}
          ${printConfig.showTaxLine ? `<div class="row"><span>Impuestos:</span><span>${formatMXN(sale.tax)}</span></div>` : ''}
          <div class="row total-row"><span>TOTAL:</span><span>${formatMXN(sale.total)}</span></div>
          <div class="footer">
            <p class="thanks">${printConfig.footerText || '¡Gracias por su compra!'}</p>
            <p class="legal">Comprobante simplificado sin validez fiscal</p>
          </div>
    `;

    // Ticket CSS, generated for a given scope selector so it can style either a full document
    // (scope 'body') or a container div living inside the app (scope '#logicpos-print-root').
    const ticketStyles = (scope: string) => `
            ${scope} { font-family: 'Courier New', Courier, monospace; font-size: ${baseFontSize}; line-height: 1.45; color: #000; max-width: ${bodyMaxWidth}; margin: 0 auto; background: #fff; box-sizing: border-box; }
            ${scope} * { box-sizing: border-box; }
            ${scope} .header { text-align: center; margin-bottom: 6px; }
            ${scope} .logo { display: block; margin: 0 auto 6px; width: 64px; height: 64px; object-fit: contain; filter: grayscale(1) contrast(1.1); }
            ${scope} .biz-name { font-size: ${isA4 ? '20px' : '15px'}; font-weight: 900; letter-spacing: 0.5px; margin: 0 0 2px; text-transform: uppercase; }
            ${scope} .tagline { font-size: 9px; margin: 0 0 4px; color: #555; }
            ${scope} .txn-id { font-size: 9px; color: #666; margin: 0; }
            ${scope} p { margin: 0 0 4px; }
            ${scope} .sep { border: none; border-top: 1px dashed #555; margin: 6px 0; }
            ${scope} .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
            ${scope} .bold { font-weight: bold; }
            ${scope} .total-row { font-size: ${isA4 ? '16px' : '13px'}; font-weight: 900; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
            ${scope} .footer { text-align: center; margin-top: 8px; }
            ${scope} .footer .thanks { font-weight: 900; font-size: ${isA4 ? '14px' : '12px'}; }
            ${scope} .footer .legal { font-size: 9px; color: #777; margin-top: 3px; }
    `;

    const ticketText = `
      <html>
        <head>
          <title>Ticket ${sale.id}</title>
          <style>
            ${ticketStyles('body')}
            body { padding: ${bodyPadding}; }
            @media print {
              @page { size: ${pageSize}; margin: ${pageMargin}; }
              body { padding: 0; margin: 0 auto; }
            }
          </style>
        </head>
        <body>${ticketBodyHtml}</body>
      </html>
    `;

    // Shared ESC/POS bytes for every direct-to-printer path below (native Bluetooth, WebUSB,
    // Web Bluetooth) — only the transport differs between them.
    const buildEscPosTicket = () => buildReceiptEscPos({
      businessName: ticketBusinessName,
      tagline: ticketTagline,
      saleId: sale.id,
      timestamp: sale.timestamp,
      payLabel,
      customerName: sale.customerName,
      employeeName: sale.employeeName,
      items: sale.items,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      showTaxLine: printConfig.showTaxLine,
      footerText: printConfig.footerText || '¡Gracias por su compra!',
      columns: columnsForPaperWidth(printConfig.paperWidth),
      formatMXN,
    });

    if (isNativePlatform && bluetoothPrinter) {
      // Thermal ESC/POS printers (e.g. MERION PT-B1) don't implement Android's Print
      // Framework, so they never appear in ReceiptPrinter's system dialog below — instead we
      // talk straight to the paired device over Bluetooth SPP with raw ESC/POS bytes.
      BluetoothPrinter.printEscPos({ address: bluetoothPrinter.address, data: uint8ToBase64(buildEscPosTicket()) })
        .then(() => {
          options?.onSuccess?.();
        })
        .catch(err => {
          console.error('Bluetooth print error:', err);
          const msg = `No se pudo imprimir en "${bluetoothPrinter.name}". Verifica que esté encendida y emparejada.`;
          if (options?.onError) options.onError(msg);
          else alert(msg);
        });
      return;
    }

    if (isNativePlatform) {
      // Android's WebView never shows a print dialog on window.print() by itself — it needs
      // native support wired up (see ReceiptPrinterPlugin.java), which loads this HTML into
      // its own offscreen WebView and hands it to android.print.PrintManager. That's the
      // native "elige tu impresora" dialog: Bluetooth/WiFi printers or Guardar como PDF.
      ReceiptPrinter.print({ html: ticketText, jobName: `Ticket ${sale.id}` })
        .then(() => {
          options?.onSuccess?.();
        })
        .catch(err => {
          console.error('Native print error:', err);
          const msg = 'No se pudo abrir el diálogo de impresión. Intenta de nuevo.';
          if (options?.onError) options.onError(msg);
          else alert(msg);
        });
      return;
    }

    if (webUsbDevice || webBluetoothDevice) {
      // Same idea as the native Bluetooth path above, but reached from a plain browser tab —
      // WebUSB/Web Bluetooth talk straight to the printer, bypassing window.print() entirely.
      const printPromise = webUsbDevice
        ? printUsb(webUsbDevice, buildEscPosTicket())
        : printBluetooth(webBluetoothDevice!, buildEscPosTicket());
      printPromise
        .then(() => {
          options?.onSuccess?.();
        })
        .catch(err => {
          console.error('Web printer error:', err);
          const msg = `No se pudo imprimir en "${webPrinterInfo?.name || 'la impresora'}". ${err?.message || ''}`;
          if (options?.onError) options.onError(msg);
          else alert(msg);
        });
      return;
    }

    if (webPrinterInfo) {
      // A Bluetooth printer was configured, but Web Bluetooth doesn't allow silently
      // reattaching after a page reload the way WebUSB does — needs one click to resume.
      const msg = `Reconecta tu impresora "${webPrinterInfo.name}" desde Ajustes > Impresora antes de imprimir.`;
      if (options?.onError) options.onError(msg);
      else alert(msg);
      return;
    }

    // Web: open the ticket in its own tab that prints itself on load.
    // Open flow runs synchronously; trigger onSuccess directly.
    options?.onSuccess?.();

    // Web: open the ticket in its own tab that prints itself on load. This is the only
    // approach verified to render correctly on Chrome for Android (tested on the client's
    // device): its print service rasterizes the *visible page* — it ignores both hidden
    // iframes and @media print show/hide scoping in the main document, which is why those
    // two earlier attempts printed a screenshot of the app (the "¡Venta Registrada!" modal)
    // instead of the ticket. In a dedicated tab, the visible page IS the ticket. `load`
    // only fires once images (the logo) are in.
    // The in-app-WebView navigation bug that originally motivated moving away from
    // window.open only affected the APK, which no longer reaches this code path at all
    // (native Bluetooth/ReceiptPrinter branches return above).
    //
    // Closing the tab needs per-platform care: on desktop print() blocks until the dialog
    // is dismissed, so close() right after is safe. On Chrome for Android print() returns
    // immediately while the system print UI is still compositing the page in the background —
    // closing right away kills the source document mid-read and the print preview shows
    // "error al cargar el archivo". There the tab goes hidden while the print UI is on top,
    // so we close it only when it becomes visible again (job sent or cancelled).
    const printScript = `
      <script>
        window.addEventListener('load', function () {
          if (/Android/i.test(navigator.userAgent)) {
            var wasHidden = false;
            document.addEventListener('visibilitychange', function () {
              if (document.visibilityState === 'hidden') { wasHidden = true; }
              else if (wasHidden) { window.close(); }
            });
            window.print();
          } else {
            window.print();
            window.close();
          }
        });
      <\/script>
    `;
    const popupHtml = ticketText.replace('</body>', printScript + '</body>');
    const ticketWindow = window.open('', '_blank');
    if (ticketWindow) {
      ticketWindow.document.open();
      ticketWindow.document.write(popupHtml);
      ticketWindow.document.close();
      return;
    }

    // Popup blocked: fall back to rendering the ticket inside the main document and hiding
    // everything else via @media print. Fine on desktop browsers; on Chrome for Android it
    // may print the visible screen instead (see above), so the popup path is preferred.
    document.getElementById('logicpos-print-root')?.remove();
    document.getElementById('logicpos-print-style')?.remove();

    const printStyle = document.createElement('style');
    printStyle.id = 'logicpos-print-style';
    printStyle.textContent = `
      #logicpos-print-root { display: none; }
      ${ticketStyles('#logicpos-print-root')}
      @media print {
        @page { size: ${pageSize}; margin: ${pageMargin}; }
        html, body { background: #fff !important; }
        body > *:not(#logicpos-print-root) { display: none !important; }
        #logicpos-print-root { display: block !important; padding: ${bodyPadding}; }
      }
    `;

    const printRoot = document.createElement('div');
    printRoot.id = 'logicpos-print-root';
    printRoot.innerHTML = ticketBodyHtml;

    document.body.appendChild(printStyle);
    document.body.appendChild(printRoot);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      printRoot.remove();
      printStyle.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Wait for the logo image (if any) to finish loading, otherwise it prints blank.
    const images = Array.from(printRoot.querySelectorAll('img'));
    const imagesReady = Promise.all(
      images.map(img => img.complete ? Promise.resolve() : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); }))
    );
    imagesReady.then(() => {
      setTimeout(() => {
        try {
          window.print();
        } catch (err) {
          console.error('Print error:', err);
          cleanup();
        }
        // Fallback for browsers that never fire `afterprint`.
        setTimeout(cleanup, 120000);
      }, 100);
    });
  };

  const handlePrintPrecuenta = (
    order: { id: string; waiterName: string; openedAt: string; items: { name: string; quantity: number; unitPrice: number }[] },
    table: { name: string },
    options?: { onSuccess?: () => void; onError?: (msg: string) => void }
  ) => {
    const ticketBusinessName = branding.displayName || (activeCompanyId ? userCompanies[activeCompanyId]?.name : '') || 'Mi Comercio';
    const ticketTagline = branding.tagline || '';
    const ticketLogo = (printConfig.showLogo && branding.logoUrl) ? branding.logoUrl : '';

    const pw = printConfig.paperWidth;
    const isA4 = pw === 'A4';
    const pageSize = isA4 ? 'A4' : `${pw} auto`;
    const pageMargin = isA4 ? '1cm' : '0mm';
    const bodyMaxWidth = pw === '58mm' ? '220px' : pw === '80mm' ? '302px' : '640px';
    const bodyPadding = isA4 ? '20px 40px' : '10px 14px';
    const baseFontSize = pw === '58mm' ? '11px' : '12px';

    const subtotal = order.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const tax = printConfig.showTaxLine ? subtotal * 0.16 : 0;
    const total = subtotal;

    const timestampFormatted = new Date().toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

    // Inner ticket markup
    const ticketBodyHtml = `
          <div class="header">
            ${ticketLogo ? `<img src="${ticketLogo}" class="logo" alt="logo">` : ''}
            <p class="biz-name">${ticketBusinessName}</p>
            ${ticketTagline ? `<p class="tagline">${ticketTagline}</p>` : ''}
            <p class="txn-id" style="font-weight: 900; font-size: 13px; text-decoration: underline; margin-top: 4px;">*** PRE-CUENTA ***</p>
            <p class="txn-id" style="font-weight: 900; font-size: 10px; margin-bottom: 6px;">NO ES COMPROBANTE DE PAGO</p>
          </div>
          <hr class="sep">
          <p><b>Mesa:</b> ${table.name}</p>
          <p><b>Fecha Solicitud:</b> ${timestampFormatted}</p>
          <p><b>Atendido por:</b> ${order.waiterName}</p>
          <p><b>ID Comanda:</b> ${order.id.slice(-6).toUpperCase()}</p>
          <hr class="sep">
          <p class="bold">CONSUMO PRELIMINAR:</p>
          ${order.items.map(it => `
            <div class="row">
              <span>${it.quantity}x ${it.name}</span>
              <span>${formatMXN(it.unitPrice * it.quantity)}</span>
            </div>
          `).join('')}
          <hr class="sep">
          <div class="row"><span>Subtotal:</span><span>${formatMXN(subtotal)}</span></div>
          ${printConfig.showTaxLine ? `<div class="row"><span>IVA (16%):</span><span>${formatMXN(tax)}</span></div>` : ''}
          <div class="row total-row"><span>TOTAL:</span><span>${formatMXN(total)}</span></div>
          <div class="footer">
            <p class="thanks" style="font-size: 11px; margin-top: 8px; font-weight: 900;">FAVOR DE PAGAR EN CAJA</p>
            <p class="legal">Comprobante preliminar sin validez fiscal</p>
          </div>
    `;

    const ticketStyles = (scope: string) => `
            ${scope} { font-family: 'Courier New', Courier, monospace; font-size: ${baseFontSize}; line-height: 1.45; color: #000; max-width: ${bodyMaxWidth}; margin: 0 auto; background: #fff; box-sizing: border-box; }
            ${scope} * { box-sizing: border-box; }
            ${scope} .header { text-align: center; margin-bottom: 6px; }
            ${scope} .logo { display: block; margin: 0 auto 6px; width: 64px; height: 64px; object-fit: contain; filter: grayscale(1) contrast(1.1); }
            ${scope} .biz-name { font-size: ${isA4 ? '20px' : '15px'}; font-weight: 900; letter-spacing: 0.5px; margin: 0 0 2px; text-transform: uppercase; }
            ${scope} .tagline { font-size: 9px; margin: 0 0 4px; color: #555; }
            ${scope} .txn-id { font-size: 9px; color: #666; margin: 0; }
            ${scope} p { margin: 0 0 4px; }
            ${scope} .sep { border: none; border-top: 1px dashed #555; margin: 6px 0; }
            ${scope} .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
            ${scope} .bold { font-weight: bold; }
            ${scope} .total-row { font-size: ${isA4 ? '16px' : '13px'}; font-weight: 900; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
            ${scope} .footer { text-align: center; margin-top: 8px; }
            ${scope} .footer .thanks { font-weight: 900; font-size: ${isA4 ? '14px' : '12px'}; }
            ${scope} .footer .legal { font-size: 9px; color: #777; margin-top: 3px; }
    `;

    if (isNativePlatform && bluetoothPrinter) {
      const columns = columnsForPaperWidth(printConfig.paperWidth);
      const bytes = buildPrecuentaEscPos({
        businessName: ticketBusinessName,
        tagline: ticketTagline,
        tableName: table.name,
        waiterName: order.waiterName,
        orderId: order.id,
        timestamp: timestampFormatted,
        items: order.items,
        showTaxLine: printConfig.showTaxLine,
        columns,
        formatMXN
      });
      BluetoothPrinter.printEscPos({ address: bluetoothPrinter.address, data: uint8ToBase64(bytes) })
        .then(() => options?.onSuccess?.())
        .catch(err => {
          console.error('Bluetooth print error:', err);
          const msg = `No se pudo imprimir en "${bluetoothPrinter.name}".`;
          if (options?.onError) options.onError(msg);
          else alert(msg);
        });
      return;
    }

    if (isNativePlatform) {
      const popupHtml = `
        <html>
          <head>
            <title>Precuenta ${table.name}</title>
            <style>
              ${ticketStyles('body')}
              body { padding: ${bodyPadding}; }
            </style>
          </head>
          <body>${ticketBodyHtml}</body>
        </html>
      `;
      ReceiptPrinter.print({ html: popupHtml, jobName: `Precuenta ${table.name}` })
        .then(() => options?.onSuccess?.())
        .catch(err => {
          console.error('Native print error:', err);
          const msg = 'No se pudo abrir el diálogo de impresión.';
          if (options?.onError) options.onError(msg);
          else alert(msg);
        });
      return;
    }

    if (webUsbDevice || webBluetoothDevice) {
      const columns = columnsForPaperWidth(printConfig.paperWidth);
      const bytes = buildPrecuentaEscPos({
        businessName: ticketBusinessName,
        tagline: ticketTagline,
        tableName: table.name,
        waiterName: order.waiterName,
        orderId: order.id,
        timestamp: timestampFormatted,
        items: order.items,
        showTaxLine: printConfig.showTaxLine,
        columns,
        formatMXN
      });
      const printPromise = webUsbDevice
        ? printUsb(webUsbDevice, bytes)
        : printBluetooth(webBluetoothDevice!, bytes);
      printPromise
        .then(() => options?.onSuccess?.())
        .catch(err => {
          console.error('Web printer error:', err);
          const msg = `No se pudo imprimir en la impresora. ${err?.message || ''}`;
          if (options?.onError) options.onError(msg);
          else alert(msg);
        });
      return;
    }

    options?.onSuccess?.();

    const printScript = `
      <script>
        window.addEventListener('load', function () {
          if (/Android/i.test(navigator.userAgent)) {
            var wasHidden = false;
            document.addEventListener('visibilitychange', function () {
              if (document.visibilityState === 'hidden') { wasHidden = true; }
              else if (wasHidden) { window.close(); }
            });
            window.print();
          } else {
            window.print();
            window.close();
          }
        });
      <\/script>
    `;
    const popupHtml = `
      <html>
        <head>
          <title>Precuenta ${table.name}</title>
          <style>
            ${ticketStyles('body')}
            body { padding: ${bodyPadding}; }
            @media print {
              @page { size: ${pageSize}; margin: ${pageMargin}; }
              body { padding: 0; margin: 0 auto; }
            }
          </style>
        </head>
        <body>${ticketBodyHtml}</body>
      </html>
    `.replace('</body>', printScript + '</body>');

    const ticketWindow = window.open('', '_blank');
    if (ticketWindow) {
      ticketWindow.document.open();
      ticketWindow.document.write(popupHtml);
      ticketWindow.document.close();
      return;
    }

    document.getElementById('logicpos-print-root')?.remove();
    document.getElementById('logicpos-print-style')?.remove();

    const printStyle = document.createElement('style');
    printStyle.id = 'logicpos-print-style';
    printStyle.textContent = `
      #logicpos-print-root { display: none; }
      ${ticketStyles('#logicpos-print-root')}
      @media print {
        @page { size: ${pageSize}; margin: ${pageMargin}; }
        html, body { background: #fff !important; }
        body > *:not(#logicpos-print-root) { display: none !important; }
        #logicpos-print-root { display: block !important; padding: ${bodyPadding}; }
      }
    `;

    const printRoot = document.createElement('div');
    printRoot.id = 'logicpos-print-root';
    printRoot.innerHTML = ticketBodyHtml;

    document.body.appendChild(printStyle);
    document.body.appendChild(printRoot);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      printRoot.remove();
      printStyle.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    const images = Array.from(printRoot.querySelectorAll('img'));
    const imagesReady = Promise.all(
      images.map(img => img.complete ? Promise.resolve() : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); }))
    );
    imagesReady.then(() => {
      setTimeout(() => {
        try {
          window.print();
        } catch (err) {
          console.error('Print error:', err);
          cleanup();
        }
        setTimeout(cleanup, 120000);
      }, 100);
    });
  };

  // Product Creator/Editor State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodForm, setProdForm] = useState({
    name: '',
    category: '',
    costPrice: '',
    salePrice: '',
    stock: '',
    minStock: '',
    sku: '',
    supplierId: '', // Associated supplier link
    printDestination: 'ninguno' as 'cocina' | 'barra' | 'ninguno'
  });

  // Quick add-stock ("Surtir") — adds units to the ACTIVE branch instead of overwriting
  // the total. Faster than editing the article (no need to read the current number and
  // do mental math). Goes through applyStockDeltas so it's atomic and per-branch.
  const [quickStockProduct, setQuickStockProduct] = useState<Product | null>(null);
  const [quickStockAmount, setQuickStockAmount] = useState('');
  const [isSavingQuickStock, setIsSavingQuickStock] = useState(false);

  const handleQuickAddStock = async () => {
    if (!quickStockProduct) return;
    const qty = parseInt(quickStockAmount);
    if (isNaN(qty) || qty === 0) {
      alert('Ingresa una cantidad válida (mayor a 0 para sumar, negativa para restar).');
      return;
    }
    setIsSavingQuickStock(true);
    try {
      // Positive = surtido (entrada); negative = merma/ajuste. Per-branch + atomic.
      await applyStockDeltas([{ productId: quickStockProduct.id, branchId: selectedBranchId, qtyDelta: qty }]);
      // Record it in the inventory audit log so it shows in Historial and the PDF.
      const branchName = branches.find(b => b.id === selectedBranchId)?.name;
      await logStockMovements([{
        type: qty > 0 ? 'surtido' : 'merma',
        productId: quickStockProduct.id,
        productName: quickStockProduct.name,
        quantity: Math.abs(qty),
        branchId: selectedBranchId,
        branchName,
      }]);
      setQuickStockProduct(null);
      setQuickStockAmount('');
    } catch (err) {
      console.error('Quick stock error:', err);
      alert('No se pudo actualizar el stock. Intenta de nuevo.');
    } finally {
      setIsSavingQuickStock(false);
    }
  };


  const handleOpenProductModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setProdForm({
        name: product.name,
        category: product.category,
        costPrice: product.costPrice.toString(),
        salePrice: product.salePrice.toString(),
        stock: getProductStock(product, selectedBranchId).toString(),
        minStock: product.minStock.toString(),
        sku: product.sku || '',
        supplierId: product.supplierId || '',
        printDestination: product.printDestination || 'ninguno'
      });
    } else {
      setEditingProduct(null);
      setProdForm({
        name: '',
        category: '',
        costPrice: '',
        salePrice: '',
        stock: '',
        minStock: '5',
        sku: '',
        supplierId: '',
        printDestination: 'ninguno'
      });
    }
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = (e: FormEvent) => {
    e.preventDefault();
    if (!prodForm.name || !prodForm.salePrice) {
      alert('Nombre y Precio de Venta son obligatorios.');
      return;
    }

    const salePriceNum = parseFloat(prodForm.salePrice);
    const costPriceNum = parseFloat(prodForm.costPrice) || 0;
    const stockNum = parseInt(prodForm.stock) || 0;
    const minStockNum = parseInt(prodForm.minStock) || 0;

    let updatedProducts: Product[];
    if (editingProduct) {
      updatedProducts = products.map(p => {
        if (p.id === editingProduct.id) {
          const branchStocks = { ...(p.branchStocks || {}) };
          branchStocks[selectedBranchId] = stockNum;
          return {
            ...p,
            name: prodForm.name,
            category: prodForm.category || DEFAULT_PRODUCT_CATEGORY,
            costPrice: costPriceNum,
            salePrice: salePriceNum,
            stock: stockNum,
            minStock: minStockNum,
            sku: prodForm.sku,
            supplierId: prodForm.supplierId || undefined,
            printDestination: prodForm.printDestination || 'ninguno',
            branchStocks
          };
        }
        return p;
      });
    } else {
      const newProd: Product = {
        id: 'P-' + Math.floor(Math.random() * 90000 + 10000),
        name: prodForm.name,
        category: prodForm.category || 'Varios',
        costPrice: costPriceNum,
        salePrice: salePriceNum,
        stock: stockNum,
        minStock: minStockNum,
        sku: prodForm.sku || 'SKU-' + Math.floor(Math.random() * 900000),
        supplierId: prodForm.supplierId || undefined,
        printDestination: prodForm.printDestination || 'ninguno',
        branchStocks: { [selectedBranchId]: stockNum }
      };
      updatedProducts = [...products, newProd];
    }

    saveAllData(updatedProducts, customers, sales, cashRegister);
    setIsProductModalOpen(false);
  };

  const handleDeleteProduct = async (prodId: string) => {
    if (confirm('¿Está seguro de que desea eliminar este producto del catálogo?')) {
      const updated = products.filter(p => p.id !== prodId);
      if (user && activeCompanyId) {
        try {
          await deleteDoc(doc(db, 'companies', activeCompanyId, 'products', prodId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `companies/${activeCompanyId}/products/${prodId}`);
        }
      }
      saveAllData(updated, customers, sales, cashRegister);
    }
  };

  const handleDownloadDashboard = async () => {
    let csvContent = "\uFEFF";
    csvContent += "REPORTE DE RENDIMIENTO - DASHBOARD GENERAL\n";
    csvContent += `Periodo: ${statsMonth === 'all' ? 'Todo el hist\u00F3rico' : getMonthLabel(statsMonth)}\n`;
    csvContent += `Fecha de exportacion: ${new Date().toLocaleDateString()}\n\n`;

    csvContent += "METRICAS CLAVE\n";
    csvContent += `Ingreso Bruto,${stats.grossRevenue.toFixed(2)} MXN\n`;
    csvContent += `Ganancia Estimada,${stats.profit.toFixed(2)} MXN\n`;
    csvContent += `Ticket Promedio,${stats.averageTicket.toFixed(2)} MXN\n`;
    csvContent += `Productos con Bajo Stock,${stats.lowStockItems.length} articulos\n\n`;

    csvContent += "VENTAS POR CATEGORIA\n";
    csvContent += "Categoria,Unidades Vendidas\n";
    Object.entries(stats.categoryPopularity).forEach(([cat, val]) => {
      csvContent += `${cat.replace(/,/g, ' ')},${val}\n`;
    });
    csvContent += "\n";

    csvContent += "RESUMEN DE SUCURSALES\n";
    csvContent += "Sucursal,Ventas Totales del periodo\n";
    // `sales` in memory is now scoped to only the active branch (see the branch-scoped
    // listener), so the other branches' totals for this cross-branch summary are fetched
    // fresh here, once, only when this export is actually clicked. Fetched in parallel but
    // appended in `branches` order afterward, since Promise.all resolves out of order.
    if (user && activeCompanyId) {
      const compId = activeCompanyId;
      const branchTotals = await Promise.all(branches.map(async (b) => {
        const snap = await getDocs(query(
          collection(db, 'companies', compId, 'sales'),
          where('branchId', '==', b.id),
          where('status', '==', 'Completed')
        ));
        let bTotal = 0;
        snap.forEach(d => {
          const s = d.data() as Sale;
          if (statsMonth === 'all' || getSaleMonthKey(s) === statsMonth) bTotal += s.total;
        });
        return bTotal;
      }));
      branches.forEach((b, i) => {
        csvContent += `${b.name.replace(/,/g, ' ')},${branchTotals[i].toFixed(2)} MXN\n`;
      });
    }

    await saveFileOnDevice(`informe_dashboard_${new Date().toISOString().split('T')[0]}.csv`, utf8ToBase64(csvContent), 'text/csv');
  };

  // Revenue shown on each branch's card in the Sucursales tab — the only screen (besides
  // AuditView/Facturación below) that needs every branch's totals at once. `sales` itself is
  // now scoped to just the active branch (see the branch-scoped listener above), so this fetches
  // each other branch's completed sales on demand, only while this tab is open, instead of
  // keeping a live company-wide sales listener running at all times.
  const [branchRevenueStats, setBranchRevenueStats] = useState<Record<string, { revenue: number; count: number }>>({});
  // Throttle: `branches` (a dependency below) gets a new array reference every time its
  // onSnapshot listener reconnects — common on phones that get backgrounded during a busy
  // shift — which would otherwise silently re-run this all-branches query every reconnect while
  // this tab happens to be open, on top of whoever re-opens the tab to check revenue. Skip
  // refetching if the last successful fetch was less than 10 minutes ago.
  const branchRevenueFetchedAtRef = useRef(0);
  useEffect(() => {
    if (activeTab !== 'branches' || !user || !activeCompanyId || branches.length === 0) return;
    if (Date.now() - branchRevenueFetchedAtRef.current < 10 * 60 * 1000) return;
    branchRevenueFetchedAtRef.current = Date.now(); // set before the fetch, not after, so two rapid re-fires can't both slip past the throttle check
    let cancelled = false;
    const compId = activeCompanyId;
    (async () => {
      try {
        const entries = await Promise.all(branches.map(async (branch) => {
          const snap = await getDocs(query(
            collection(db, 'companies', compId, 'sales'),
            where('branchId', '==', branch.id),
            where('status', '==', 'Completed')
          ));
          let revenue = 0;
          snap.forEach(d => { revenue += (d.data() as Sale).total; });
          return [branch.id, { revenue, count: snap.size }] as const;
        }));
        if (!cancelled) setBranchRevenueStats(Object.fromEntries(entries));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `companies/${compId}/sales (branch revenue summary)`);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, user, activeCompanyId, branches]);

  // Facturación (CFDI) lists invoices from every branch at once, so — same reasoning as
  // branchRevenueStats above — it keeps its own state fetched on demand instead of reading the
  // now branch-scoped `sales`. Kept deliberately separate from `sales` so marking an invoice as
  // facturado/pendiente here can never overwrite the active branch's live sales state via
  // saveAllData.
  const [invoiceSales, setInvoiceSales] = useState<Sale[]>([]);
  // Same throttle as branchRevenueFetchedAtRef above: skip refetching if someone leaves and
  // re-enters this tab within 10 minutes — avoids repeatedly paying for the whole company's
  // invoice-flagged sales just from someone checking back and forth.
  const invoiceSalesFetchedAtRef = useRef(0);
  useEffect(() => {
    if (activeTab !== 'invoicing' || !user || !activeCompanyId) return;
    if (Date.now() - invoiceSalesFetchedAtRef.current < 10 * 60 * 1000) return;
    invoiceSalesFetchedAtRef.current = Date.now();
    let cancelled = false;
    const compId = activeCompanyId;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'companies', compId, 'sales'), where('requiresInvoice', '==', true)));
        const list: Sale[] = [];
        snap.forEach(d => list.push(d.data() as Sale));
        if (!cancelled) setInvoiceSales(list);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `companies/${compId}/sales (facturacion)`);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, user, activeCompanyId]);

  // Updates one sale's invoiceStatus directly (not via saveAllData, which would replace the
  // branch-scoped `sales` state) and reflects it in the locally-fetched invoiceSales list.
  const handleSetInvoiceStatus = async (saleId: string, status: 'completed' | 'pending') => {
    if (!user || !activeCompanyId) return;
    try {
      await updateDoc(doc(db, 'companies', activeCompanyId, 'sales', saleId), { invoiceStatus: status });
      setInvoiceSales(prev => prev.map(s => s.id === saleId ? { ...s, invoiceStatus: status } : s));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/sales/${saleId}`);
    }
  };

  // AuditView cross-references sales+orders+cashRegisters across every branch — same reasoning
  // as the two above, `sales` fetched fresh on demand instead of a permanent company-wide
  // listener. `orders`/`cashRegisters` are NOT scoped this way: both are already company-wide by
  // design (Fase 2b) and, unlike `sales`, are small/bounded collections, not the fast-growing
  // history that was driving Firestore read-quota consumption.
  const [auditSales, setAuditSales] = useState<Sale[]>([]);
  const auditSalesFetchedAtRef = useRef(0);
  useEffect(() => {
    if (activeTab !== 'audit' || !user || !activeCompanyId) return;
    if (Date.now() - auditSalesFetchedAtRef.current < 10 * 60 * 1000) return;
    auditSalesFetchedAtRef.current = Date.now();
    let cancelled = false;
    const compId = activeCompanyId;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'companies', compId, 'sales'));
        const list: Sale[] = [];
        snap.forEach(d => list.push(d.data() as Sale));
        if (!cancelled) setAuditSales(list);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `companies/${compId}/sales (auditoria)`);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, user, activeCompanyId]);

  const handleExportProducts = async () => {
    let csvContent = "\uFEFF";
    csvContent += "REPORTE DE CATALOGO E INVENTARIO GENERAL\n";
    csvContent += `Fecha de exportacion: ${new Date().toLocaleDateString()}\n`;
    csvContent += `Comercio: ${userCompanies[activeCompanyId || '']?.name || 'Empresa'}\n\n`;

    // Headers with specific Branch stocks
    let headers = "ID,Nombre,Categoria,PRECIO COMPRA (Costo),PRECIO VENTA,STOCK TOTAL,ALERTA MINIMA,SKU";
    branches.forEach(b => {
      headers += `,Stock - ${b.name.replace(/,/g, ' ')}`;
    });
    csvContent += headers + "\n";

    products.forEach(p => {
      let row = `"${p.id}","${p.name.replace(/"/g, '""')}",` +
                `"${(p.category || DEFAULT_PRODUCT_CATEGORY).replace(/"/g, '""')}",` +
                `${p.costPrice || 0},${p.salePrice || 0},${p.stock || 0},${p.minStock || 0},` +
                `"${p.sku || ''}"`;
      
      branches.forEach(b => {
        const val = p.branchStocks && p.branchStocks[b.id] !== undefined ? p.branchStocks[b.id] : p.stock;
        row += `,${val}`;
      });
      csvContent += row + "\n";
    });

    await saveFileOnDevice(`catalogo_productos_e_inventario_${new Date().toISOString().split('T')[0]}.csv`, utf8ToBase64(csvContent), 'text/csv');
  };

  // Generates a downloadable PDF "Corte Mensual" (monthly statement) for the currently
  // selected branch and month — every past month with recorded sales is selectable,
  // since the underlying history in Firestore is never pruned.
  const handleDownloadMonthlyCutPdf = async () => {
    const isSelectedMatriz = branches.find(b => b.id === selectedBranchId)?.isMatriz ?? false;
    const branchName = branches.find(b => b.id === selectedBranchId)?.name || 'Sucursal';
    const companyName = branding.displayName || userCompanies[activeCompanyId || '']?.name || 'Mi Comercio';

    const monthSales = sales
      .filter(s =>
        (s.branchId === selectedBranchId || (!s.branchId && isSelectedMatriz)) &&
        getSaleMonthKey(s) === pdfCutMonth
      )
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const completedSales = monthSales.filter(s => s.status === 'Completed');
    const refundedSales = monthSales.filter(s => s.status === 'Refunded');
    const grossRevenue = completedSales.reduce((acc, s) => acc + s.total, 0);
    const totalDiscount = completedSales.reduce((acc, s) => acc + (s.discount || 0), 0);
    const totalTax = completedSales.reduce((acc, s) => acc + (s.tax || 0), 0);
    const refundedTotal = refundedSales.reduce((acc, s) => acc + s.total, 0);

    const paymentLabels: Record<Sale['paymentMethod'], string> = { Cash: 'Efectivo', Card: 'Tarjeta', Transfer: 'Transferencia', Credit: 'Crédito (Fiado)' };
    const byPaymentMethod: Record<string, { count: number; total: number }> = {};
    completedSales.forEach(s => {
      const key = paymentLabels[s.paymentMethod];
      if (!byPaymentMethod[key]) byPaymentMethod[key] = { count: 0, total: 0 };
      byPaymentMethod[key].count += 1;
      byPaymentMethod[key].total += s.total;
    });

    // Manual cash movements (entradas/retiros de efectivo) for the same period — `time`
    // only has the hour, not the date, so only entries with the newer `createdAt` field
    // can be placed in a specific month; older entries recorded before that field existed
    // are left out rather than guessed at.
    const msToMonthKey = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const monthCashMovements = cashRegister.transactions
      .filter((tx): tx is typeof tx & { createdAt: number } =>
        (tx.type === 'Ingreso' || tx.type === 'Egreso') &&
        tx.createdAt !== undefined && msToMonthKey(tx.createdAt) === pdfCutMonth
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    const totalIngresos = monthCashMovements.filter(t => t.type === 'Ingreso').reduce((acc, t) => acc + t.amount, 0);
    const totalEgresos = monthCashMovements.filter(t => t.type === 'Egreso').reduce((acc, t) => acc + t.amount, 0);

    // Inventory movements (surtidos + transfers) for this branch and month.
    const monthStockMovements = stockMovements
      .filter(m => m.branchId === selectedBranchId && msToMonthKey(m.createdAt) === pdfCutMonth)
      .sort((a, b) => a.createdAt - b.createdAt);
    const stockTypeLabel = (t: StockMovement['type']) =>
      t === 'surtido' ? 'Surtido' : t === 'merma' ? 'Merma/Ajuste' : t === 'transfer_in' ? 'Traspaso entrada' : 'Traspaso salida';

    const doc = new jsPDF();
    const monthLabel = getMonthLabel(pdfCutMonth);

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Corte Mensual de Ventas', 14, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${companyName} — ${branchName}`, 14, 25);
    doc.text(`Periodo: ${monthLabel}`, 14, 31);
    doc.text(`Generado: ${new Date().toLocaleString()}`, 14, 37);

    autoTable(doc, {
      startY: 44,
      theme: 'grid',
      head: [['Resumen del periodo', '']],
      body: [
        ['Ventas completadas', String(completedSales.length)],
        ['Ingreso total del periodo', formatMXN(grossRevenue)],
        ['Descuentos aplicados', formatMXN(totalDiscount)],
        ['Impuestos cobrados', formatMXN(totalTax)],
        ['Ventas reembolsadas', `${refundedSales.length} (${formatMXN(refundedTotal)})`],
        ...Object.entries(byPaymentMethod).map(([label, v]) => [`  · ${label}`, `${v.count} — ${formatMXN(v.total)}`]),
        ['Entradas de efectivo (manuales)', `${monthCashMovements.filter(t => t.type === 'Ingreso').length} (${formatMXN(totalIngresos)})`],
        ['Retiros de efectivo (manuales)', `${monthCashMovements.filter(t => t.type === 'Egreso').length} (${formatMXN(totalEgresos)})`],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [51, 65, 85] },
      columnStyles: { 1: { halign: 'right' } },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 90;

    if (monthSales.length > 0) {
      autoTable(doc, {
        startY: finalY + 8,
        head: [['Fecha', 'Folio', 'Cliente', 'Cajero', 'Método', 'Total', 'Estado']],
        body: monthSales.map(s => [
          s.timestamp,
          s.id,
          s.customerName || 'Público General',
          s.employeeName || '—',
          paymentLabels[s.paymentMethod],
          formatMXN(s.total),
          s.status === 'Completed' ? 'Completada' : 'Reembolsada'
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [51, 65, 85] },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 6 && data.cell.raw === 'Reembolsada') {
            data.cell.styles.textColor = [190, 30, 60];
          }
        }
      });
    } else {
      doc.setFontSize(10);
      doc.text('No hay ventas registradas para este periodo.', 14, finalY + 10);
    }

    const finalY2 = monthSales.length > 0 ? ((doc as any).lastAutoTable?.finalY ?? finalY + 20) : finalY + 16;

    if (monthCashMovements.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Entradas y Retiros de Efectivo (manuales)', 14, finalY2 + 10);
      autoTable(doc, {
        startY: finalY2 + 14,
        head: [['Hora', 'Tipo', 'Descripción', 'Monto']],
        body: monthCashMovements.map(t => [
          t.time,
          t.type === 'Ingreso' ? 'Entrada' : 'Retiro',
          t.description,
          formatMXN(t.amount)
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [51, 65, 85] },
        columnStyles: { 3: { halign: 'right' } },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 1) {
            data.cell.styles.textColor = data.cell.raw === 'Entrada' ? [16, 122, 87] : [190, 30, 60];
          }
        }
      });
    }

    const finalY3 = monthCashMovements.length > 0 ? ((doc as any).lastAutoTable?.finalY ?? finalY2 + 20) : finalY2;

    if (monthStockMovements.length > 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Movimientos de Inventario (surtidos y traspasos)', 14, finalY3 + 12);
      autoTable(doc, {
        startY: finalY3 + 16,
        head: [['Hora', 'Producto', 'Tipo', 'Origen/Destino', 'Unidades']],
        body: monthStockMovements.map(m => {
          const isIn = m.type === 'surtido' || m.type === 'transfer_in';
          return [
            m.timestamp,
            m.productName,
            stockTypeLabel(m.type),
            m.counterpartBranchName ? `${isIn ? 'desde' : 'hacia'} ${m.counterpartBranchName}` : '—',
            `${isIn ? '+' : '-'}${m.quantity}`
          ];
        }),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [51, 65, 85] },
        columnStyles: { 4: { halign: 'right' } },
      });
    }

    // jsPDF's own .save() has the same web-only <a download> problem as the CSV exports
    // above — extract the base64 payload from a data URI instead and route it through the
    // same cross-platform saveFileOnDevice() helper.
    const pdfDataUri = doc.output('datauristring');
    const pdfBase64 = pdfDataUri.split('base64,')[1];
    await saveFileOnDevice(`corte_mensual_${branchName.replace(/[^a-zA-Z0-9]/g, '_')}_${pdfCutMonth}.pdf`, pdfBase64, 'application/pdf');
  };

  // Branch Office (Sucursal) State & Forms
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchForm, setBranchForm] = useState({
    name: '',
    address: '',
    phone: '',
    manager: '',
    isMatriz: false
  });

  // Goods Transfer between Branches (Transferencia multisuccursal y de matriz)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferProductId, setTransferProductId] = useState('');
  const [transferSourceBranchId, setTransferSourceBranchId] = useState('');
  const [transferTargetBranchId, setTransferTargetBranchId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState(1);

  const handleOpenTransferModal = (prodId?: string) => {
    setTransferProductId(prodId || (products[0]?.id || ''));
    // Set default source and target if branches exist
    if (branches.length > 0) {
      const matriz = branches.find(b => b.isMatriz) || branches[0];
      setTransferSourceBranchId(matriz.id);
      const other = branches.find(b => b.id !== matriz.id) || branches[0];
      setTransferTargetBranchId(other.id);
    }
    setTransferQuantity(1);
    setIsTransferModalOpen(true);
  };

  const handleExecuteTransfer = async () => {
    if (!transferProductId || !transferSourceBranchId || !transferTargetBranchId) {
      alert("Por favor selecciona el producto, la sucursal origen y la sucursal destino.");
      return;
    }
    if (transferSourceBranchId === transferTargetBranchId) {
      alert("La sucursal de origen y destino no pueden ser la misma.");
      return;
    }
    if (transferQuantity <= 0) {
      alert("La cantidad a transferir debe ser mayor que cero.");
      return;
    }

    const prod = products.find(p => p.id === transferProductId);
    if (!prod) {
      alert("Producto no encontrado.");
      return;
    }

    // Source values (early UX-level check; the transfer itself re-applies atomically below)
    const sourceStocks = { ...(prod.branchStocks || {}) };
    const sourceStockVal = sourceStocks[transferSourceBranchId] !== undefined ? sourceStocks[transferSourceBranchId] : prod.stock;

    if (sourceStockVal < transferQuantity) {
      alert(`La sucursal de origen no tiene suficientes existencias. Stock disponible: ${sourceStockVal} unidades.`);
      return;
    }

    if (user && activeCompanyId) {
      try {
        // Single Firestore transaction: decrements source + increments target together,
        // reading the live document instead of a possibly-stale local copy.
        await applyStockDeltas([
          { productId: transferProductId, branchId: transferSourceBranchId, qtyDelta: -transferQuantity },
          { productId: transferProductId, branchId: transferTargetBranchId, qtyDelta: transferQuantity }
        ]);

        // Record both sides in the inventory audit log (dedicated collection, not the cash
        // register): an "out" entry for the source branch and an "in" entry for the target.
        const sourceBranchName = branches.find(b => b.id === transferSourceBranchId)?.name || 'Sucursal';
        const targetBranchName = branches.find(b => b.id === transferTargetBranchId)?.name || 'Sucursal';
        await logStockMovements([
          {
            type: 'transfer_out',
            productId: transferProductId,
            productName: prod.name,
            quantity: transferQuantity,
            branchId: transferSourceBranchId,
            branchName: sourceBranchName,
            counterpartBranchId: transferTargetBranchId,
            counterpartBranchName: targetBranchName,
          },
          {
            type: 'transfer_in',
            productId: transferProductId,
            productName: prod.name,
            quantity: transferQuantity,
            branchId: transferTargetBranchId,
            branchName: targetBranchName,
            counterpartBranchId: transferSourceBranchId,
            counterpartBranchName: sourceBranchName,
          },
        ]);

        alert(`¡Transferencia exitosa! Se movieron ${transferQuantity} unidades de "${prod.name}" desde sucursal origen a destino.`);
        setIsTransferModalOpen(false);
        setTransferProductId('');
        setTransferQuantity(1);
      } catch (err) {
        console.error("Error executing branch transfer:", err);
        alert("Ocurrió un error al guardar los cambios en la base de datos de Firebase.");
      }
    } else {
      const targetStocks = { ...(prod.branchStocks || {}) };
      const targetStockVal = targetStocks[transferTargetBranchId] !== undefined ? targetStocks[transferTargetBranchId] : prod.stock;
      sourceStocks[transferSourceBranchId] = sourceStockVal - transferQuantity;
      sourceStocks[transferTargetBranchId] = targetStockVal + transferQuantity;
      const updatedProducts = products.map(p => p.id === transferProductId ? { ...p, branchStocks: sourceStocks } : p);
      saveAllData(updatedProducts, customers, sales, cashRegister);
      alert(`¡Transferencia exitosa (Modo Offline)!`);
      setIsTransferModalOpen(false);
    }
  };

  const handleOpenBranchModal = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setBranchForm({
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        manager: branch.manager,
        isMatriz: !!branch.isMatriz
      });
    } else {
      setEditingBranch(null);
      setBranchForm({ name: '', address: '', phone: '', manager: '', isMatriz: false });
    }
    setIsBranchModalOpen(true);
  };

  const handleSaveBranch = (e: FormEvent) => {
    e.preventDefault();
    if (!branchForm.name) {
      alert('El nombre de la sucursal es obligatorio.');
      return;
    }

    let updated: Branch[];
    if (editingBranch) {
      updated = branches.map(b => b.id === editingBranch.id ? {
        ...b,
        name: branchForm.name,
        address: branchForm.address,
        phone: branchForm.phone,
        manager: branchForm.manager,
        isMatriz: !!branchForm.isMatriz
      } : b);
    } else {
      const newB: Branch = {
        id: 'B-' + Math.floor(Math.random() * 9000 + 1000),
        name: branchForm.name,
        address: branchForm.address,
        phone: branchForm.phone,
        manager: branchForm.manager,
        isMatriz: !!branchForm.isMatriz,
        // Seeded with today's names so existing tables (already stamped with these zone
        // strings) don't go orphaned — fully editable afterwards via "Editar Zonas".
        zones: ['Principal', 'Terraza', 'Bar/VIP']
      };
      updated = [...branches, newB];
    }
    saveAllData(products, customers, sales, cashRegister, updated, suppliers);
    setIsBranchModalOpen(false);
  };

  const handleDeleteBranch = async (bId: string) => {
    if (branches.length <= 1) {
      alert('Debe haber al menos una sucursal registrada en el sistema.');
      return;
    }
    if (confirm('¿Está seguro de eliminar esta sucursal?')) {
      const updated = branches.filter(b => b.id !== bId);
      const nextActive = selectedBranchId === bId ? updated[0].id : selectedBranchId;
      setSelectedBranchId(nextActive);
      localStorage.setItem('logic_active_branch', nextActive);
      if (user && activeCompanyId) {
        try {
          await deleteDoc(doc(db, 'companies', activeCompanyId, 'branches', bId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `companies/${activeCompanyId}/branches/${bId}`);
        }
      }
      saveAllData(products, customers, sales, cashRegister, updated, suppliers);
    }
  };

  // Supplier (Proveedor) State & Forms
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    category: 'General'
  });

  const [supplierProductIds, setSupplierProductIds] = useState<string[]>([]);

  const handleOpenSupplierModal = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setSupplierForm({
        name: supplier.name,
        contactName: supplier.contactName,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        category: supplier.category
      });
      const linked = products.filter(p => p.supplierId === supplier.id).map(p => p.id);
      setSupplierProductIds(linked);
    } else {
      setEditingSupplier(null);
      setSupplierForm({ name: '', contactName: '', phone: '', email: '', address: '', category: 'General' });
      setSupplierProductIds([]);
    }
    setIsSupplierModalOpen(true);
  };

  const handleSaveSupplier = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name) {
      alert('El nombre del proveedor es obligatorio.');
      return;
    }

    const targetSupplierId = editingSupplier ? editingSupplier.id : ('prov-' + Math.floor(Math.random() * 90000 + 10000));

    let updated: Supplier[];
    if (editingSupplier) {
      updated = suppliers.map(s => s.id === editingSupplier.id ? {
        ...s,
        name: supplierForm.name,
        contactName: supplierForm.contactName,
        phone: supplierForm.phone,
        email: supplierForm.email,
        address: supplierForm.address,
        category: supplierForm.category
      } : s);
    } else {
      const newS: Supplier = {
        id: targetSupplierId,
        name: supplierForm.name,
        contactName: supplierForm.contactName,
        phone: supplierForm.phone,
        email: supplierForm.email,
        address: supplierForm.address,
        category: supplierForm.category
      };
      updated = [...suppliers, newS];
    }

    // Link/unlink products on firebase/localStorage
    const processedProducts = products.map(p => {
      const shouldBeLinked = supplierProductIds.includes(p.id);
      if (shouldBeLinked) {
        return { ...p, supplierId: targetSupplierId };
      } else if (p.supplierId === targetSupplierId) {
        const updatedProd = { ...p };
        delete updatedProd.supplierId;
        return updatedProd;
      }
      return p;
    });

    saveAllData(processedProducts, customers, sales, cashRegister, branches, updated);
    setIsSupplierModalOpen(false);
  };

  const handleDeleteSupplier = async (sId: string) => {
    if (confirm('¿Está seguro de eliminar este proveedor? Los artículos correspondientes se desvincularán del proveedor.')) {
      const updated = suppliers.filter(s => s.id !== sId);
      const updatedProducts = products.map(p => p.supplierId === sId ? { ...p, supplierId: undefined } : p);
      if (user && activeCompanyId) {
        try {
          await deleteDoc(doc(db, 'companies', activeCompanyId, 'suppliers', sId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `companies/${activeCompanyId}/suppliers/${sId}`);
        }
      }
      saveAllData(updatedProducts, customers, sales, cashRegister, branches, updated);
    }
  };

  // Supplier Supply Order (Surtido / Compra) State & Handler
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [restockForm, setRestockForm] = useState({
    supplierId: '',
    productId: '',
    qty: '',
    cost: ''
  });

  const handleOpenRestock = (supplierId?: string, productId?: string) => {
    setRestockForm({
      supplierId: supplierId || '',
      productId: productId || '',
      qty: '',
      cost: ''
    });
    setIsRestockOpen(true);
  };

  const handleSaveRestock = (e: FormEvent) => {
    e.preventDefault();
    const { supplierId, productId, qty, cost } = restockForm;
    if (!supplierId || !productId || !qty || !cost) {
      alert('Por favor complete todos los campos para procesar el reabastecimiento.');
      return;
    }
    const q = parseInt(qty);
    const c = parseFloat(cost);
    if (isNaN(q) || q <= 0 || isNaN(c) || c <= 0) {
      alert('Ingrese una cantidad y costo unitario válidos.');
      return;
    }

    const prod = products.find(p => p.id === productId);
    const supp = suppliers.find(s => s.id === supplierId);
    if (!prod || !supp) return;

    const totalExpense = q * c;

    // Optional confirmation if register is low on cash
    if (cashRegister.currentCash < totalExpense) {
      if (!confirm(`La caja actual tiene ${formatMXN(cashRegister.currentCash)} y el gasto total es de ${formatMXN(totalExpense)}. ¿Desea proceder con saldo negativo en caja?`)) {
        return;
      }
    }

    // Stock increment is atomic (transaction); cost/supplier metadata is a plain field set
    applyStockDeltas([{ productId, branchId: selectedBranchId, qtyDelta: q }]);
    if (user && activeCompanyId) {
      updateDoc(doc(db, 'companies', activeCompanyId, 'products', productId), {
        costPrice: c, // Record new supplier cost price automatically!
        supplierId
      }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/products/${productId}`));
    }

    // Outflow Egreso in Register (atomic — see applyCashDelta)
    applyCashDelta(selectedBranchId, -totalExpense, [{
      type: 'Egreso',
      amount: totalExpense,
      description: `Surtido de Stock: ${q}x ${prod.name} (Ref: ${supp.name})`,
      time: new Date().toLocaleTimeString(),
      createdAt: Date.now()
    }]);

    setIsRestockOpen(false);
    alert(`¡Reabastecimiento procesado! Se añadieron ${q} unidades de ${prod.name} y se generó un egreso de ${formatMXN(totalExpense)} en Caja.`);
  };


  // Customer State & Forms
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [custForm, setCustForm] = useState({
    name: '',
    phone: '',
    email: ''
  });

  const handleOpenCustomerModal = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      setCustForm({ name: customer.name, phone: customer.phone, email: customer.email });
    } else {
      setEditingCustomer(null);
      setCustForm({ name: '', phone: '', email: '' });
    }
    setIsCustomerModalOpen(true);
  };

  const handleSaveCustomer = (e: FormEvent) => {
    e.preventDefault();
    if (!custForm.name) return;

    let updatedCustomers: Customer[];
    if (editingCustomer) {
      updatedCustomers = customers.map(c => c.id === editingCustomer.id ? {
        ...c,
        name: custForm.name,
        phone: custForm.phone,
        email: custForm.email
      } : c);
    } else {
      const newCust: Customer = {
        id: 'C-' + Math.floor(Math.random() * 90000 + 10000),
        name: custForm.name,
        phone: custForm.phone,
        email: custForm.email,
        unpaidBalance: 0,
        registeredDate: new Date().toISOString().substring(0, 10)
      };
      updatedCustomers = [...customers, newCust];
    }

    saveAllData(products, updatedCustomers, sales, cashRegister);
    setIsCustomerModalOpen(false);
  };

  const handlePayBalance = (custId: string, amountToPay: number) => {
    if (amountToPay <= 0) return;
    const target = customers.find(c => c.id === custId);
    if (!target) return;

    const actualPayAmount = Math.min(target.unpaidBalance, amountToPay);
    if (actualPayAmount <= 0) {
      alert('Este cliente no tiene saldo pendiente.');
      return;
    }

    applyCustomerBalanceDelta(custId, -actualPayAmount);
    applyCashDelta(selectedBranchId, actualPayAmount, [{
      type: 'Ingreso',
      amount: actualPayAmount,
      description: `Abono "Fiado" de ${target.name}`,
      time: new Date().toLocaleTimeString(),
      createdAt: Date.now()
    }]);
    alert(`Abono aplicado con éxito: ${formatMXN(actualPayAmount)}`);
  };

  // Refund Venta
  const handleRefundSale = (saleId: string) => {
    if (confirm('¿Está seguro de que desea REEMBOLSAR esta venta? Se restituirá el inventario.')) {
      const sale = sales.find(s => s.id === saleId);
      if (!sale) return;

      // Restore inventories atomically (per-product Firestore transaction)
      applyStockDeltas(sale.items.map(item => ({
        productId: item.productId,
        branchId: sale.branchId || selectedBranchId,
        qtyDelta: item.quantity
      })));

      // Adjust customer balance if it was Credit (atomic)
      if (sale.customerId && sale.paymentMethod === 'Credit') {
        applyCustomerBalanceDelta(sale.customerId, -sale.total);
      }

      // Deduct from cash if it was Cash, but always log in transactions audit history (atomic)
      const refundPaymentLabel = sale.paymentMethod === 'Cash' ? 'Efectivo' : sale.paymentMethod === 'Card' ? 'Tarjeta' : sale.paymentMethod === 'Transfer' ? 'Transferencia' : 'Crédito';
      const refundBranchId = sale.branchId || selectedBranchId;
      applyCashDelta(refundBranchId, sale.paymentMethod === 'Cash' ? -sale.total : 0, [{
        type: 'Egreso',
        amount: sale.total,
        description: `Cancelación/Reembolso Venta ${sale.id} (${refundPaymentLabel})`,
        time: new Date().toLocaleTimeString(),
        createdAt: Date.now(),
        branchId: refundBranchId
      }]);

      // Status change (only this single sale doc gets written/diffed)
      const updatedSales = sales.map(s => s.id === saleId ? { ...s, status: 'Refunded' as const } : s);
      saveAllData(products, customers, updatedSales, cashRegister);
      alert('Venta reembolsada con éxito.');
    }
  };

  // Cash Management State
  const [cashFlowAmount, setCashFlowAmount] = useState('');
  const [cashFlowDesc, setCashFlowDesc] = useState('');
  const [historySubTab, setHistorySubTab] = useState<'sales' | 'cashLog' | 'inventory'>('sales');

  // Statistics month scope: 'all' shows all-time totals, otherwise a specific "YYYY-MM"
  const [statsMonth, setStatsMonth] = useState<string>(getCurrentMonthKey());
  // Month scope for the "Corte Mensual (PDF)" export in Historial/Caja
  const [pdfCutMonth, setPdfCutMonth] = useState<string>(getCurrentMonthKey());
  
  const handleRecordCashFlow = (type: 'Ingreso' | 'Egreso') => {
    const val = parseFloat(cashFlowAmount);
    if (isNaN(val) || val <= 0) {
      alert('Ingresa un valor válido.');
      return;
    }
    if (!cashFlowDesc) {
      alert('Ingresa una descripción.');
      return;
    }

    const valueSigned = type === 'Ingreso' ? val : -val;
    applyCashDelta(selectedBranchId, valueSigned, [{
      type,
      amount: val,
      description: cashFlowDesc,
      time: new Date().toLocaleTimeString(),
      createdAt: Date.now(),
      branchId: selectedBranchId
    }]);
    setCashFlowAmount('');
    setCashFlowDesc('');
    alert(`Registo de ${type} en caja de ${formatMXN(val)} guardado.`);
  };


  // Sales/transactions scoped to the currently selected branch — shared by the POS
  // terminal's quick history, the Historial/Caja tab, and the analytics below, so
  // switching branches consistently filters everything derived from `sales`.
  const isSelectedBranchMatriz = useMemo(() => branches.find(b => b.id === selectedBranchId)?.isMatriz ?? false, [branches, selectedBranchId]);
  const branchScopedSales = useMemo(() =>
    sales.filter(s => s.branchId === selectedBranchId || (!s.branchId && isSelectedBranchMatriz)),
    [sales, selectedBranchId, isSelectedBranchMatriz]
  );
  // `cashRegister` is now the selected branch's own document (see the dedicated
  // onSnapshot effect above), so every entry in it already belongs to this branch —
  // no filtering needed here anymore, unlike branchScopedSales above.
  const branchScopedTransactions = cashRegister.transactions;

  // Inventory movements (surtidos + transfers) that touch the active branch.
  const branchScopedStockMovements = useMemo(
    () => stockMovements.filter(m => m.branchId === selectedBranchId),
    [stockMovements, selectedBranchId]
  );

  // 'Transferencia' entries carry a unit count in `amount`, not a currency value —
  // formatMXN would misleadingly render "5" as "$5.00 MXN".
  const formatTxAmount = (tx: CashRegister['transactions'][number]) =>
    tx.type === 'Transferencia' ? `${tx.amount} unid.` : formatMXN(tx.amount);

  // Analytics helper metrics
  const availableStatsMonths = useMemo(() => getAvailableMonths(sales), [sales]);

  const stats = useMemo(() => {
    const isSelectedMatriz = branches.find(b => b.id === selectedBranchId)?.isMatriz ?? false;
    const activeSales = sales.filter(s =>
      s.status === 'Completed' &&
      (s.branchId === selectedBranchId || (!s.branchId && isSelectedMatriz)) &&
      (statsMonth === 'all' || getSaleMonthKey(s) === statsMonth)
    );
    const grossRevenue = activeSales.reduce((acc, s) => acc + s.total, 0);
    const cost = activeSales.reduce((acc, s) => {
      // For each sale item, calculate cost
      return acc + s.items.reduce((itemCost, item) => {
        const prod = products.find(p => p.id === item.productId);
        const singleCost = prod ? prod.costPrice : 0;
        return itemCost + (singleCost * item.quantity);
      }, 0);
    }, 0);
    
    // Profit margin calculation
    const profit = Math.max(0, grossRevenue - cost);
    const averageTicket = activeSales.length > 0 ? grossRevenue / activeSales.length : 0;
    
    // Low stocks counts
    const lowStockItems = products.filter(p => getProductStock(p, selectedBranchId) <= p.minStock);

    // Group sales by Category
    const categoryPopularity: { [key: string]: number } = {};
    activeSales.forEach(s => {
      s.items.forEach(item => {
        const p = products.find(prod => prod.id === item.productId);
        const cat = p?.category || DEFAULT_PRODUCT_CATEGORY;
        categoryPopularity[cat] = (categoryPopularity[cat] || 0) + item.quantity;
      });
    });

    return { grossRevenue, profit, averageTicket, lowStockItems, categoryPopularity, activeSalesCount: activeSales.length };
  }, [sales, products, selectedBranchId, branches, statsMonth]);

  // Inline style for active nav buttons — adapts to brand palette
  const navActiveStyle: React.CSSProperties = {
    backgroundColor: `color-mix(in srgb, var(--brand-primary) 14%, white)`,
    color: `var(--brand-primary)`,
    borderColor: `color-mix(in srgb, var(--brand-primary) 22%, transparent)`,
  };
  const navBaseClass = 'flex flex-row items-center space-x-3 px-4 py-2.5 rounded-xl transition duration-150 font-semibold text-sm w-full cursor-pointer flex-shrink-0';
  const navInactiveClass = `${navBaseClass} text-slate-600 hover:bg-slate-50 hover:text-slate-900`;
  const navActiveClass = `${navBaseClass} shadow-sm border`;

  // Hard login gate: nothing below this point (catalog, sales, sucursales, estadisticas,
  // caja, etc.) mounts until Firebase Auth resolves to a real user. There used to be a
  // "Modo Local" that ran the whole POS off localStorage without any login — besides
  // showing operational data to whoever opened the page, saveAllData() mirrors every
  // authenticated write into those same localStorage keys as an offline-durability cache,
  // so a logged-out session on a previously-used device could actually surface real
  // production data. Gating the entire render on `user` closes that regardless of what's
  // sitting in localStorage.
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-400 text-sm font-bold">
          <ShoppingCart className="w-5 h-5 animate-pulse" />
          Conectando...
        </div>
      </div>
    );
  }

  // Kiosk-bound device: skip the full company-code form and go straight to the
  // PIN pad for the company this device was configured for (Fase 3). "Regresar"
  // in the pad is the discreet reset — it unbinds the device and falls back to
  // the two-field form / Google below.
  if (!user && kioskCompanyId) {
    return (
      <EmployeePinLogin
        onPinSubmit={handleKioskPinSubmit}
        onCancel={handleUnbindKiosk}
        errorMessage={kioskSignInError}
        isSubmitting={isKioskSignInLoading}
      />
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-5 text-left animate-slide-up">
          <div className="text-center pb-2.5 border-b border-slate-100 space-y-2">
            <div className="w-12 h-12 mx-auto bg-indigo-50 rounded-2xl flex items-center justify-center">
              <ShoppingCart className="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-800">LOGIC POS RESTAURANTES</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Ingresa con tu número de empleado o cuenta de propietario.</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* EMPLOYEE CODE LOGIN */}
            <form onSubmit={handleCredentialSignIn} className="space-y-3.5">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-left">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Ingresa el <strong className="text-slate-700">Código de Comercio</strong> y tu <strong className="text-slate-700">Número de Empleado</strong> asignado por tu encargado.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 font-bold block">Código de Comercio *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: comp_123456"
                  value={authCompanyId}
                  onChange={(e) => setAuthCompanyId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-bold text-slate-700 placeholder-slate-300 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-500 font-bold block">Número de Empleado *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 1001"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-bold text-slate-700 placeholder-slate-300 text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={isSignInLoading}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs rounded-xl shadow cursor-pointer transition select-none tracking-wide text-center disabled:opacity-50 mt-1"
              >
                {isSignInLoading ? 'Verificando...' : 'Entrar al Sistema'}
              </button>
            </form>

            {authError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] text-red-700 font-semibold whitespace-pre-line">
                {authError}
              </div>
            )}

            {/* SEPARATOR */}
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink mx-3 text-[9px] text-slate-400 font-extrabold uppercase tracking-wide bg-white px-1">propietarios</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* GOOGLE OPTION - owners only */}
            <button
              type="button"
              onClick={async () => {
                setAuthError('');
                try {
                  await signInWithGoogle();
                } catch (err: any) {
                  console.error(err);
                  setAuthError("Error al conectar con Google: " + (err.message || String(err)));
                }
              }}
              className="w-full py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-sm cursor-pointer transition flex items-center justify-center gap-2 select-none border border-slate-200"
            >
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span>Acceso con Google (Propietario)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (user && activeCompanyId && activeCompanyRole === 'mesero') {
    return (
      <WaiterShell
        user={user}
        companyName={branding.displayName || userCompanies[activeCompanyId]?.name || 'Mi Comercio'}
        activeCompanyId={activeCompanyId}
        currentUserMember={currentUserMember}
        products={products}
        branches={branches}
        tables={tables}
        orders={orders}
        customers={customers}
        selectedBranchId={selectedBranchId}
        branding={branding}
        onLogout={() => signOut(auth)}
        buildAndCommitSale={buildAndCommitSale}
        onSaleComplete={setLastCompletedSale}
        userAvailableCompanies={userCompanies}
        onLeaveCompany={() => {
          localStorage.removeItem(`logic_active_company_${user.uid}`);
          setActiveCompanyId(null);
          setActiveCompany(null);
        }}
        printConfig={printConfig}
        onPrintReceipt={handlePrintReceipt}
        onPrintPrecuenta={handlePrintPrecuenta}
      />
    );
  }

  return (
    <div id="logic-main-container" className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* Top Brand Banner */}
      <header className="text-white shadow-md px-3 lg:px-6 py-3 lg:py-4 flex justify-between items-center z-10 border-b relative gap-2"
        style={{ backgroundColor: 'var(--brand-dark)', borderColor: 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
        <div className="flex items-center gap-2 lg:gap-3 shrink min-w-0 flex-1">
          <button
            className="lg:hidden p-1.5 rounded-xl transition flex-shrink-0"
            style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 55%, black)', border: '1px solid color-mix(in srgb, var(--brand-primary) 30%, transparent)', color: 'color-mix(in srgb, var(--brand-primary) 70%, white)' }}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <Menu className="w-5 h-5" />
          </button>
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt="Logo" className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl object-contain hidden md:block flex-shrink-0 bg-white/10 p-0.5" />
          ) : (
            <div className="p-2 lg:p-2.5 rounded-xl shadow-inner hidden md:block flex-shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 55%, black)', border: '1px solid color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
              <ShoppingCart id="logic-banner-logo" className="w-5 h-5 lg:w-6 lg:h-6 animate-pulse" style={{ color: 'color-mix(in srgb, var(--brand-primary) 60%, white)' } as React.CSSProperties} />
            </div>
          )}
          <div className="flex flex-col min-w-0 shrink">
            <div className="flex items-center space-x-2">
              <span className="text-lg lg:text-xl font-black tracking-wider truncate" style={{ color: 'var(--brand-primary)' }}>
                {branding.displayName || (user && activeCompanyId ? userCompanies[activeCompanyId]?.name : 'POS Cloud')}
              </span>
              {user && activeCompanyId ? (
                <span className="hidden md:inline-block px-2 py-0.5 text-white font-bold text-[10px] rounded-full shadow-sm uppercase shrink-0" style={{ backgroundColor: 'var(--brand-primary)' }}>
                  {userCompanies[activeCompanyId]?.role === 'owner' ? 'Propietario' : userCompanies[activeCompanyId]?.role === 'master_admin' ? 'Master Admin' : userCompanies[activeCompanyId]?.role === 'admin' ? 'Admin' : 'Empleado'}
                </span>
              ) : (
                <span className="hidden md:inline-block px-2 py-0.5 text-white font-bold text-[10px] rounded-full shadow-sm shrink-0" style={{ backgroundColor: 'var(--brand-primary)' }}>LOGIC POS</span>
              )}
            </div>
             {/* Active Branch Switching Selector in Header */}
            {branches.length > 0 && (
              <div className="mt-1 flex items-center space-x-1 overflow-hidden shrink min-w-0">
                <span className="text-[9px] lg:text-[10px] font-extrabold uppercase tracking-wider hidden sm:block" style={{ color: 'color-mix(in srgb, var(--brand-primary) 65%, white)' }}>Sucursal:</span>
                {activeCompanyRole === 'employee' ? (
                  <span className="border rounded px-1.5 lg:px-2 py-0.5 text-[9px] lg:text-[10px] font-bold truncate text-white" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 80%, black)', borderColor: 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
                    <MapPin className="w-2.5 h-2.5 inline mr-0.5" />{branches.find(b => b.id === selectedBranchId)?.name || 'Sucursal Principal'}
                  </span>
                ) : (
                  <select
                    value={selectedBranchId}
                    onChange={(e) => handleSelectBranch(e.target.value)}
                    className="text-white text-[9px] lg:text-[10px] font-bold rounded px-1 lg:px-1.5 py-0.5 outline-none cursor-pointer transition truncate max-w-[100px] sm:max-w-xs border"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 70%, black)', borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, transparent)' }}
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id} className="bg-slate-900 text-white font-semibold">{b.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Real-time Clock and Auth on right */}
        <div className="flex items-center space-x-2 lg:space-x-4 flex-shrink-0">
          <div className="hidden lg:flex items-center space-x-2 text-sm font-medium opacity-90">
            <span className="px-2.5 py-1 rounded-md border font-bold text-white text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 60%, transparent)', borderColor: 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
              Caja Registradora: {formatMXN(cashRegister.currentCash)}
            </span>
            <span className="text-xs px-2 py-1 rounded border font-semibold text-white" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 50%, transparent)', borderColor: 'color-mix(in srgb, var(--brand-primary) 25%, transparent)' }}>
              {nowStr}
            </span>
          </div>

          {/* Authentication Status UI — `user` is always set here: the login gate above
              already returned early otherwise. */}
          <div className="flex items-center space-x-1.5 lg:space-x-2.5 px-2 lg:px-3 py-1 lg:py-1.5 rounded-xl border" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 45%, transparent)', borderColor: 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || ''} className="hidden sm:block w-5 h-5 lg:w-6 lg:h-6 rounded-full border-2" style={{ borderColor: 'var(--brand-primary)' }} referrerPolicy="no-referrer" />
            ) : (
              <div className="hidden sm:flex w-5 h-5 lg:w-6 lg:h-6 rounded-full font-black text-xs text-center leading-6 text-white items-center justify-center" style={{ backgroundColor: 'var(--brand-primary)' }}>
                {user.displayName ? user.displayName[0].toUpperCase() : 'U'}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-[11px] font-bold text-white leading-tight truncate max-w-[120px]">
                {currentUserMember?.name || user.displayName || 'Comerciante'}
              </p>
              {(() => {
                const role = currentUserMember?.role;
                let colorClass = 'text-slate-400';
                let Icon = Users;
                let label = 'Usuario';

                if (role === 'owner') {
                  colorClass = 'text-amber-500';
                  Icon = ShieldCheck;
                  label = 'Dueño';
                } else if (role === 'master_admin') {
                  colorClass = 'text-purple-400';
                  Icon = ShieldCheck;
                  label = 'Master Admin';
                } else if (role === 'admin') {
                  colorClass = 'text-blue-400';
                  Icon = ShieldCheck;
                  label = 'Administrador';
                } else if (role === 'employee') {
                  colorClass = 'text-emerald-400';
                  Icon = CircleDollarSign;
                  label = 'Cajero';
                } else if (role === 'mesero') {
                  colorClass = 'text-amber-500';
                  Icon = Utensils;
                  label = 'Mesero';
                } else if (!role) {
                  colorClass = 'text-amber-500';
                  Icon = ShieldCheck;
                  label = 'Dueño';
                }

                return (
                  <span className={`text-[9px] font-extrabold uppercase tracking-widest flex items-center gap-1 mt-0.5 ${colorClass}`}>
                    <Icon className="w-2.5 h-2.5 shrink-0" />
                    <span>{label}</span>
                  </span>
                );
              })()}
            </div>
            <div className="flex space-x-1 lg:space-x-1.5 flex-shrink-0">
              {(!currentUserMember || currentUserMember?.role === 'owner' || currentUserMember?.role === 'master_admin') && (
                <button
                  onClick={() => { localStorage.removeItem(`logic_active_company_${user.uid}`); setActiveCompanyId(null); }}
                  className="text-[9px] lg:text-[10px] text-white font-bold px-2 lg:px-2.5 py-1 rounded-lg cursor-pointer transition select-none border"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 70%, black)', borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, transparent)' }}
                  title="Cambiar de comercio / empresa"
                >
                  <span className="hidden sm:inline">Empresas</span>
                  <span className="sm:hidden">Emp</span>
                </button>
              )}
              <button
                onClick={() => signOut(auth)}
                className="text-[9px] lg:text-[10px] bg-red-700 hover:bg-red-600 border border-red-600 text-white font-bold px-2 lg:px-2.5 py-1 rounded-lg cursor-pointer transition select-none"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Alert Warn: Unclosed cash register from previous day */}
      {showOvernightWarning && (
        <div className="bg-gradient-to-r from-amber-500 via-amber-655 to-red-600 text-white px-6 py-3 shadow-md flex justify-between items-center space-x-4 animate-pulse z-10 border-b border-amber-500/10">
          <div className="flex items-center space-x-3 text-xs leading-relaxed">
            <AlertCircle className="w-5 h-5 flex-shrink-0 animate-bounce text-white" />
            <div>
              <span className="font-black text-xs block tracking-wider uppercase opacity-90">Alerta Contable</span>
              El sistema detectó que <strong className="underline">no se realizó el corte de caja</strong> el día anterior (<span className="font-mono">{warningOperationalDate || 'ayer'}</span>). Por favor, realiza el corte antes de registrar ventas hoy para mantener la contabilidad exacta y organizada.
            </div>
          </div>
          <div className="flex items-center space-x-2.5 flex-shrink-0">
            <button
              onClick={() => {
                setRealCashInput(cashRegister.currentCash.toString());
                setIsCorteModalOpen(true);
              }}
              className="bg-white text-amber-900 hover:bg-amber-50 font-extrabold text-[10px] px-3.5 py-1.5 rounded-lg shadow-sm cursor-pointer border border-amber-200 transition uppercase tracking-wider"
            >
              Hacer Corte Ahora
            </button>
            <button
              onClick={() => setShowOvernightWarning(false)}
              className="text-white hover:text-slate-100 font-bold p-1 hover:bg-white/10 rounded-full cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Alert Warn: Cash register closed — needs opening before selling */}
      {!cashRegister.isOpen && showClosedCajaBanner && (
        <div className="bg-gradient-to-r from-amber-500 via-amber-655 to-red-600 text-white px-6 py-3 shadow-md flex justify-between items-center space-x-4 animate-pulse z-10 border-b border-amber-500/10">
          <div className="flex items-center space-x-3 text-xs leading-relaxed">
            <AlertCircle className="w-5 h-5 flex-shrink-0 animate-bounce text-white" />
            <div>
              <span className="font-black text-xs block tracking-wider uppercase opacity-90">Caja Cerrada</span>
              La caja registradora está <strong className="underline">cerrada</strong>. Por favor, realiza la apertura de caja antes de registrar ventas.
            </div>
          </div>
          <div className="flex items-center space-x-2.5 flex-shrink-0">
            <button
              onClick={() => {
                setOpeningCashInput('500');
                setIsOpeningCajaModalOpen(true);
              }}
              className="bg-white text-amber-900 hover:bg-amber-50 font-extrabold text-[10px] px-3.5 py-1.5 rounded-lg shadow-sm cursor-pointer border border-amber-200 transition uppercase tracking-wider"
            >
              Abrir Caja Ahora
            </button>
            <button
              onClick={() => setShowClosedCajaBanner(false)}
              className="text-white hover:text-slate-100 font-bold p-1 hover:bg-white/10 rounded-full cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Panel Content */}
      <div className="flex-grow flex flex-col lg:flex-row relative">
        
        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="lg:hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sleek Sidebar Navigation */}
        <nav className={`${
          isMobileMenuOpen ? 'flex' : 'hidden'
        } lg:flex flex-col bg-white border-r border-slate-200/80 w-64 justify-start py-6 space-y-1.5 px-2 overflow-y-auto scrollbar-none absolute lg:relative z-50 h-full lg:h-auto shadow-2xl lg:shadow-none top-0 left-0 transition-transform`}>
          
          {[
            ...(activeCompany?.businessType === 'restaurante' ? [
              { id: 'tables',   label: 'Mesas / Salón',       icon: <Utensils className="w-5 h-5" /> }
            ] : []),
            { id: 'products',   label: 'Inventario',          icon: <Package className="w-5 h-5" /> },
            { id: 'customers',  label: 'Clientes',            icon: <Users className="w-5 h-5" /> },
          ].map(({ id, label, icon }) => (
            <button key={id} id={`nav-${id}`}
              onClick={() => { setActiveTab(id as typeof activeTab); setIsMobileMenuOpen(false); }}
              className={activeTab === id ? navActiveClass : navInactiveClass}
              style={activeTab === id ? navActiveStyle : {}}
            >
              {icon}<span className="mt-1 md:mt-0">{label}</span>
            </button>
          ))}

          {/* Historial / Caja: base access for Cajero too — abrir/cerrar turno is literally
              their job, not an admin-only concern like the tabs below. */}
          {[
            { id: 'history',    label: 'Historial / Caja',    icon: <Receipt className="w-5 h-5" /> },
          ].map(({ id, label, icon }) => (
            <button key={id} id={`nav-${id}`}
              onClick={() => { setActiveTab(id as typeof activeTab); setIsMobileMenuOpen(false); }}
              className={activeTab === id ? navActiveClass : navInactiveClass}
              style={activeTab === id ? navActiveStyle : {}}
            >
              {icon}<span className="mt-1 md:mt-0">{label}</span>
            </button>
          ))}

          {activeCompanyRole !== 'employee' && [
            { id: 'branches',   label: 'Sucursales',          icon: <Store className="w-5 h-5" /> },
            { id: 'suppliers',  label: 'Proveedores',         icon: <Truck className="w-5 h-5" /> },
            { id: 'invoicing',  label: 'Facturación',         icon: <FileText className="w-5 h-5" /> },
            { id: 'analytics',  label: 'Estadísticas',        icon: <BarChart3 className="w-5 h-5" /> },
          ].map(({ id, label, icon }) => (
            <button key={id} id={`nav-${id}`}
              onClick={() => { setActiveTab(id as typeof activeTab); setIsMobileMenuOpen(false); }}
              className={activeTab === id ? navActiveClass : navInactiveClass}
              style={activeTab === id ? navActiveStyle : {}}
            >
              {icon}<span className="mt-1 md:mt-0">{label}</span>
            </button>
          ))}

          {/* Auditoría: owner/admin/master_admin only — deliberately its own gate (not the
              `!== 'employee'` block above), since that check alone would also admit 'mesero'. */}
          {isOwnerOrAdminRole && (
            <button id="nav-audit"
              onClick={() => { setActiveTab('audit'); setIsMobileMenuOpen(false); }}
              className={activeTab === 'audit' ? navActiveClass : navInactiveClass}
              style={activeTab === 'audit' ? navActiveStyle : {}}
            >
              <ShieldCheck className="w-5 h-5" /><span className="mt-1 md:mt-0">Auditoría</span>
            </button>
          )}

          <button id="nav-settings"
            onClick={() => { setActiveTab('settings'); setIsMobileMenuOpen(false); }}
            className={activeTab === 'settings' ? navActiveClass : navInactiveClass}
            style={activeTab === 'settings' ? navActiveStyle : {}}
          >
            <Settings className="w-5 h-5" /><span className="mt-1 md:mt-0">Mi Empresa / Equipo</span>
          </button>
        </nav>

        {/* Dynamic Frame Screen Views */}
        <main className="flex-grow p-4 md:p-6 select-none overflow-y-auto max-w-7xl mx-auto w-full">
          
          {/* SCREEN: TERMINAL POS — eliminada; este despliegue es 100% flujo de restaurante
              (Mesas/Comandas), la venta directa por carrito ya no aplica. */}

          {/* SCREEN: TABLES FLOOR VIEW & COMANDA VIEW */}
          {activeTab === 'tables' && activeCompany?.businessType === 'restaurante' && (
            dashboardIsManagingOrder && dashboardSelectedTable ? (
              <ComandaView
                table={dashboardSelectedTable}
                order={orders.find(o => o.tableId === dashboardSelectedTable.id && o.status === 'open' && o.branchId === selectedBranchId) || null}
                products={products}
                customers={customers}
                activeCompanyId={activeCompanyId}
                selectedBranchId={selectedBranchId}
                currentUserMember={currentUserMember}
                user={user}
                buildAndCommitSale={buildAndCommitSale}
                onClose={() => {
                  setDashboardSelectedTable(null);
                  setDashboardIsManagingOrder(false);
                }}
                onSaleComplete={setLastCompletedSale}
                printConfig={printConfig}
                onPrintReceipt={handlePrintReceipt}
                onPrintPrecuenta={handlePrintPrecuenta}
              />
            ) : (
              <TablesFloorView
                tables={tables}
                orders={orders}
                selectedBranchId={selectedBranchId}
                activeBranchName={branches.find(b => b.id === selectedBranchId)?.name || 'Sucursal Principal'}
                activeCompanyId={activeCompanyId}
                currentUserMember={currentUserMember}
                user={user}
                onManageOrder={(table) => {
                  setDashboardSelectedTable(table);
                  setDashboardIsManagingOrder(true);
                }}
                branchZones={branches.find(b => b.id === selectedBranchId)?.zones || ['Principal', 'Terraza', 'Bar/VIP']}
              />
            )
          )}

          {/* SCREEN: INVENTARIO DE PRODUCTOS */}
          {activeTab === 'products' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800">Catálogo de Productos ({products.length})</h2>
                  <p className="text-sm text-slate-500 mt-1">Monitorea el catálogo, ajusta precios y controla el stock por sucursal.</p>
                </div>
                <div className="flex gap-2 self-start flex-wrap items-center">
                  {/* View toggle: cards vs compact list */}
                  <div className="flex bg-slate-100 border border-slate-200 rounded-xl p-0.5">
                    <button
                      onClick={() => { setInventoryView('grid'); localStorage.setItem('logic_inventory_view', 'grid'); }}
                      className={`p-2 rounded-lg transition cursor-pointer ${inventoryView === 'grid' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                      title="Vista de tarjetas"
                      aria-label="Vista de tarjetas"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setInventoryView('list'); localStorage.setItem('logic_inventory_view', 'list'); }}
                      className={`p-2 rounded-lg transition cursor-pointer ${inventoryView === 'list' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                      title="Vista de lista"
                      aria-label="Vista de lista"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                {activeCompanyRole !== 'employee' && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleExportProducts}
                      className="bg-emerald-600 hover:bg-emerald-705 text-white font-extrabold text-sm px-4 py-2.5 rounded-xl flex items-center whitespace-nowrap gap-2 cursor-pointer shadow-sm transition"
                      title="Exportar catálogo completo con existencias multisuccursal a CSV"
                    >
                      <Download className="w-4 h-4" />Exportar Inventario (CSV)
                    </button>
                    <button
                      onClick={() => setIsCategoryModalOpen(true)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-705 border border-slate-200 font-extrabold text-sm px-4 py-2.5 rounded-xl flex items-center whitespace-nowrap gap-2 cursor-pointer shadow-sm transition"
                    >
                      <Layers className="w-4 h-4 text-slate-500" />
                      Editar Categorías
                    </button>
                    <button
                      onClick={() => handleOpenProductModal()}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm px-4 py-2.5 rounded-xl flex items-center whitespace-nowrap gap-2 cursor-pointer shadow-sm transition"
                    >
                      <Plus className="w-4 h-4" />
                      + Nuevo Producto
                    </button>
                  </div>
                )}
                </div>
              </div>

              {/* Inventory: card grid or compact list depending on the user's toggle */}
              {inventoryView === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map(prod => (
                  <div key={prod.id} className="border border-slate-200/80 rounded-2xl p-4 flex flex-col justify-between hover:border-indigo-30 shadow-sm duration-150">
                    <div className="space-y-2.5">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          {prod.category}
                        </span>
                        {getProductStock(prod, selectedBranchId) <= prod.minStock && (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center animate-pulse">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Stock en Alerta
                          </span>
                        )}
                      </div>

                      <div className="flex space-x-3 items-center">
                        <span className="p-2 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-primary) 10%, white)' }}>
                          <Package className="w-6 h-6" style={{ color: 'color-mix(in srgb, var(--brand-primary) 60%, #94a3b8)' }} />
                        </span>
                        <div>
                          <h4 className="font-extrabold text-slate-800 text-sm leading-tight">{prod.name}</h4>
                          <p className="text-[10px] text-slate-400 font-mono">ID: {prod.id} {prod.sku ? `| SKU: ${prod.sku}` : ''}</p>
                          {prod.supplierId && (
                            <p className="text-[9px] text-amber-600 font-extrabold tracking-wide uppercase mt-1">
                              <Truck className="w-2.5 h-2.5 inline mr-0.5" />Prov: {suppliers.find(s => s.id === prod.supplierId)?.name || 'Desconocido'}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Costs and Prices */}
                      <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 text-xs">
                        <div className="text-center bg-slate-50 p-1.5 rounded">
                          <p className="text-slate-400 font-medium">Margen</p>
                          <p className="font-bold text-slate-800">
                            {prod.costPrice > 0 ? `${(((prod.salePrice - prod.costPrice) / prod.salePrice) * 100).toFixed(0)}%` : '100%'}
                          </p>
                        </div>
                        <div className="text-center bg-slate-50 p-1.5 rounded">
                          <p className="text-slate-400 font-medium">Costo</p>
                          <p className="font-bold text-slate-700">{formatMXN(prod.costPrice)}</p>
                        </div>
                        <div className="text-center bg-indigo-55/10 p-1.5 rounded">
                          <p className="text-indigo-400 font-medium">Precio</p>
                          <p className="font-bold text-indigo-700">{formatMXN(prod.salePrice)}</p>
                        </div>
                      </div>

                      <div className="flex justify-between text-xs font-semibold text-slate-600 pt-1">
                        <span>Cant. en Inventario:</span>
                        <span className={`font-bold ${getProductStock(prod, selectedBranchId) <= prod.minStock ? 'text-purple-650' : 'text-slate-800'}`}>{getProductStock(prod, selectedBranchId)} u.</span>
                      </div>

                      {branches.length > 1 && (
                        <div className="mt-2 bg-slate-50 p-2 rounded-lg border border-slate-100 text-[10px] space-y-1 text-left">
                          <p className="font-extrabold text-slate-400 uppercase tracking-wider">Stock por Sucursal:</p>
                          <div className="space-y-0.5 max-h-20 overflow-y-auto">
                            {branches.map(b => (
                              <div key={b.id} className="flex justify-between items-center text-slate-600 font-bold">
                                <span className="truncate">{b.name}:</span>
                                <span className={getProductStock(prod, b.id) <= prod.minStock ? 'text-amber-600' : 'text-slate-800'}>
                                  {getProductStock(prod, b.id)} u.
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {(canEditProducts || canTransferStock) ? (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        {canTransferStock && branches.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleOpenTransferModal(prod.id)}
                            className="w-full py-2 mb-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 text-xs font-black rounded-xl cursor-pointer transition text-center flex items-center justify-center space-x-1"
                          >
                            <Package className="w-3.5 h-3.5 inline mr-1" /><span>Transferir / Repartir Stock</span>
                          </button>
                        )}
                        {canEditProducts && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setQuickStockProduct(prod); setQuickStockAmount(''); }}
                              className="w-full py-2 mb-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 text-emerald-700 text-xs font-black rounded-xl cursor-pointer transition text-center flex items-center justify-center"
                              title={`Sumar unidades al stock de ${branches.find(b => b.id === selectedBranchId)?.name || 'esta sucursal'}`}
                            >
                              <Plus className="w-3.5 h-3.5 inline mr-1" /><span>Surtir Stock</span>
                            </button>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleOpenProductModal(prod)}
                                className="w-1/2 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer transition text-center"
                              >
                                Editar Art.
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(prod.id)}
                                className="w-1/2 py-2 hover:bg-purple-50 text-purple-605 text-xs font-bold rounded-xl border border-transparent hover:border-purple-200 cursor-pointer transition text-center"
                              >
                                Eliminar
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 pt-3 border-t border-slate-50 text-center text-[10px] text-slate-400 font-semibold select-none flex items-center justify-center gap-1">
                        <Settings className="w-3 h-3" />No tienes permiso para gestionar stock
                      </div>
                    )}
                  </div>
                ))}
              </div>
              ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
                {products.length === 0 && (
                  <p className="text-center text-sm text-slate-400 py-10">No hay productos en el catálogo.</p>
                )}
                {products.map(prod => {
                  const branchStock = getProductStock(prod, selectedBranchId);
                  const low = branchStock <= prod.minStock;
                  return (
                    <div key={prod.id} className="flex items-center gap-3 p-3 hover:bg-slate-50/70 transition">
                      <span className="p-2 rounded-lg shrink-0 hidden sm:flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-primary) 10%, white)' }}>
                        <Package className="w-4 h-4" style={{ color: 'color-mix(in srgb, var(--brand-primary) 60%, #94a3b8)' }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-extrabold text-slate-800 text-sm truncate">{prod.name}</p>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 shrink-0">{prod.category}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                          <span className="font-bold" style={{ color: 'var(--brand-primary)' }}>{formatMXN(prod.salePrice)}</span>
                          <span className={`font-bold ${low ? 'text-amber-600' : 'text-slate-600'}`}>
                            {low && <AlertCircle className="w-3 h-3 inline mr-0.5" />}Stock: {branchStock} u.
                          </span>
                        </div>
                      </div>
                      {canEditProducts && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => { setQuickStockProduct(prod); setQuickStockAmount(''); }}
                            className="p-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 text-emerald-700 rounded-lg cursor-pointer transition"
                            title="Surtir stock"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          {branches.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleOpenTransferModal(prod.id)}
                              className="p-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 rounded-lg cursor-pointer transition shrink-0"
                              title="Transferir / repartir stock"
                            >
                              <Package className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenProductModal(prod)}
                            className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded-lg cursor-pointer transition shrink-0"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct(prod.id)}
                            className="p-2 hover:bg-rose-50 text-rose-500 rounded-lg cursor-pointer transition"
                            title="Eliminar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          )}

          {/* SCREEN: CLIENTES / CRM */}
          {activeTab === 'customers' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800">Manejo de Clientes y Cobranza ({customers.length})</h2>
                  <p className="text-sm text-slate-500 mt-1">Registra cuentas abiertas, gestiona saldos acumulados de clientes fiados ("Crédito LOGIC") y fomenta la lealtad.</p>
                </div>
                <button
                  onClick={() => handleOpenCustomerModal()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm px-4 py-2.5 rounded-xl flex items-center whitespace-nowrap gap-2 self-start cursor-pointer shadow-sm transition"
                >
                  <UserPlus className="w-4 h-4" />
                  + Registrar Cliente
                </button>
              </div>

              {/* Customer table / profiles list */}
              <div className="space-y-4">
                {customers.map(cust => (
                  <div key={cust.id} className="border border-slate-200/80 hover:border-slate-300 rounded-2xl p-4 md:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white shadow-sm transition">
                    <div className="space-y-1.5 flex-grow">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-extrabold text-lg text-slate-800 leading-tight">{cust.name}</h4>
                        <span className="text-[10px] bg-slate-100 border text-slate-400 font-mono py-0.5 px-2 rounded-full">ID: {cust.id}</span>
                      </div>
                      
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-semibold text-slate-600">
                        <div>
                          <p className="text-slate-400 text-[10px] uppercase">Contacto Tel.</p>
                          <p className="text-slate-850 font-bold">{cust.phone || 'Vacio'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] uppercase">Correo Electrónico</p>
                          <p className="text-slate-800 font-bold truncate">{cust.email || 'Vacio'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] uppercase">Registro</p>
                          <p className="text-slate-800 font-medium">{cust.registeredDate}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px] uppercase">Puntos Fidelidad</p>
                          <p className="text-indigo-600 font-bold">120 pt.</p>
                        </div>
                      </div>
                    </div>

                    {/* Pending loan (fiado) actions on right */}
                    <div className="w-full md:w-auto p-4 bg-slate-50 border rounded-xl flex flex-col justify-between space-y-3 min-w-[220px]">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-505 font-bold">Saldo Fiado:</span>
                        <span className={`text-sm font-extrabold ${cust.unpaidBalance > 0 ? 'text-purple-605 animate-pulse' : 'text-emerald-600'}`}>
                          {formatMXN(cust.unpaidBalance)}
                        </span>
                      </div>
                      
                      {cust.unpaidBalance > 0 ? (
                        <div className="space-y-2">
                          {paymentPrompt?.customerId === cust.id ? (
                            <div className="flex bg-slate-50 border border-emerald-100 rounded-lg p-1.5 shadow-inner items-center gap-1.5 flex-1">
                              <input 
                                type="number" 
                                placeholder="Monto" 
                                value={paymentAmount} 
                                onChange={e => setPaymentAmount(e.target.value)} 
                                className="w-full bg-white border border-slate-200 text-xs px-2 py-1 rounded outline-none" 
                                autoFocus 
                              />
                              <button
                                onClick={() => {
                                  const p = parseFloat(paymentAmount);
                                  if (!isNaN(p) && p > 0) {
                                    handlePayBalance(cust.id, p);
                                    setPaymentPrompt(null);
                                  }
                                }}
                                aria-label="Confirmar pago"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1 rounded transition"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setPaymentPrompt(null)}
                                className="bg-red-50 text-red-500 hover:bg-red-100 font-bold text-xs px-2 py-1 rounded transition"
                              >
                                X
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setPaymentPrompt({customerId: cust.id, customerName: cust.name, unpaidBalance: cust.unpaidBalance});
                                setPaymentAmount('');
                              }}
                              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg cursor-pointer transition text-center shadow-inner"
                            >
                              Registrar Abono
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-center bg-emerald-50 text-emerald-700 font-semibold p-1.5 rounded flex items-center justify-center gap-1">
                          <Check className="w-3 h-3" />Cuenta al día
                        </span>
                      )}

                      <div className="flex space-x-1 justify-end">
                        <button 
                          onClick={() => handleOpenCustomerModal(cust)} 
                          className="w-full py-1 bg-white hover:bg-slate-100 text-[10px] text-slate-500 font-bold border rounded"
                        >
                          Modificar Perfil
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SCREEN: HISTORIAL DE VENTAS & CONTROL DE CAJA */}
          {activeTab === 'history' && (
            <div className="space-y-6">

              {/* Cash Register Control Card */}
              <div className="rounded-3xl p-6 text-white shadow-md grid grid-cols-1 md:grid-cols-12 gap-6 items-center border" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--brand-dark) 95%, black), color-mix(in srgb, var(--brand-dark) 82%, black), color-mix(in srgb, var(--brand-dark) 70%, black))', borderColor: 'color-mix(in srgb, var(--brand-dark) 55%, black)' }}>
                <div className="md:col-span-4 space-y-1">
                  <span className="text-[10px] font-extrabold py-1 px-3 rounded-full uppercase tracking-wider" style={{ color: 'color-mix(in srgb, var(--brand-primary) 45%, white)', backgroundColor: 'color-mix(in srgb, var(--brand-dark) 40%, black)' }}>Caja Activa (Flujo del día)</span>
                  <p className="text-2xl font-extrabold">Efectivo en Caja</p>
                  <p className="text-3xl font-black text-yellow-400">{formatMXN(cashRegister.currentCash)}</p>
                  {editInitialCashPrompt ? (
                    <div className="flex items-center gap-2 mt-2">
                       <span className="text-xs text-white/60">Monto apertura: $</span>
                       <input 
                         type="number"
                         value={newInitialCash}
                         onChange={(e) => setNewInitialCash(e.target.value)}
                         className="w-20 px-1.5 py-0.5 text-xs bg-white text-slate-800 rounded outline-none font-bold"
                         autoFocus
                       />
                       <button
                         onClick={() => {
                           const val = parseFloat(newInitialCash);
                           if (!isNaN(val) && val >= 0) {
                             const diff = val - cashRegister.initialCash;
                             if (user && activeCompanyId) {
                               setDoc(doc(db, 'companies', activeCompanyId, 'cashRegisters', selectedBranchId), {
                                 initialCash: val,
                                 currentCash: increment(diff)
                               }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `companies/${activeCompanyId}/cashRegisters/${selectedBranchId}`));
                             }
                             setEditInitialCashPrompt(false);
                           }
                         }}
                         className="bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-0.5 text-[10px] rounded font-bold transition shadow-sm flex items-center gap-1"
                       ><Check className="w-3 h-3" />Guardar
                       </button>
                       <button
                         onClick={() => setEditInitialCashPrompt(false)}
                         className="bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 text-[10px] rounded font-bold transition shadow-sm"
                       >X
                       </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-xs text-white/60">Monto de apertura: {formatMXN(cashRegister.initialCash)}</p>
                      {(activeCompanyRole === 'owner' || activeCompanyRole === 'master_admin') && (
                        <button
                          onClick={() => {
                            setEditInitialCashPrompt(true);
                            setNewInitialCash(cashRegister.initialCash.toString());
                          }}
                          className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-white transition border border-white/20 shadow-sm cursor-pointer ml-1"
                        >
                          Editar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="md:col-span-4 bg-white/10 backdrop-blur-sm p-4 rounded-2xl border border-white/15 space-y-3 text-xs flex flex-col justify-between">
                  <p className="font-extrabold text-white/90">Registrar flujo especial en Caja</p>
                  
                  <div className="flex space-x-2">
                    <input 
                      type="number"
                      placeholder="$ Monto"
                      value={cashFlowAmount}
                      onChange={e => setCashFlowAmount(e.target.value)}
                      className="bg-white/10 border border-white/20 rounded-lg p-1.5 focus:bg-white focus:text-slate-900 focus:outline-none w-1/3 text-xs text-white font-bold"
                    />
                    <input 
                      type="text"
                      placeholder="Ej: Pago de Luz / Vuelto"
                      value={cashFlowDesc}
                      onChange={e => setCashFlowDesc(e.target.value)}
                      className="bg-white/10 border border-white/20 rounded-lg p-1.5 focus:bg-white focus:text-slate-900 focus:outline-none w-2/3 text-xs text-white font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button 
                      onClick={() => handleRecordCashFlow('Ingreso')}
                      className="py-1.5 bg-emerald-500 hover:bg-emerald-600 font-bold text-[10px] rounded text-white flex items-center justify-center cursor-pointer"
                    >
                      + Registrar Ingreso
                    </button>
                    <button 
                      onClick={() => handleRecordCashFlow('Egreso')}
                      className="py-1.5 bg-pink-800 hover:bg-pink-900 font-bold text-[10px] rounded text-white flex items-center justify-center cursor-pointer"
                    >
                      - Registrar Egreso
                    </button>
                  </div>
                </div>

                {/* Cash Transactions Logs inside card */}
                <div className="md:col-span-4 p-4 rounded-2xl border h-[110px] overflow-y-auto text-[10px] space-y-1.5 font-mono" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-dark) 40%, black)', borderColor: 'color-mix(in srgb, var(--brand-dark) 30%, transparent)' }}>
                  <p className="font-bold tracking-wider uppercase pb-0.5" style={{ color: 'color-mix(in srgb, var(--brand-primary) 45%, white)', borderBottom: '1px solid color-mix(in srgb, var(--brand-dark) 30%, transparent)' }}>Auditoría rápida de movimientos</p>
                  {cashRegister.transactions.map((tx, idx) => (
                    <div key={idx} className="flex justify-between items-center text-white/80 gap-2">
                      <span className="truncate">{tx.time} - {tx.description}</span>
                      <span className={`font-bold ${tx.type === 'Ingreso' || tx.type === 'Venta' ? 'text-emerald-400' : tx.type === 'Transferencia' ? 'text-sky-300' : 'text-pink-400'}`}>
                        {tx.type === 'Egreso' ? '-' : tx.type === 'Transferencia' ? '' : '+'}{formatTxAmount(tx)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Apertura / Corte de Caja — rescatado de la extinta Terminal POS */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  cashRegister.isOpen ? 'bg-emerald-100 text-emerald-850 border border-emerald-250' : 'bg-rose-105 text-rose-800 border border-rose-250 animate-pulse'
                }`}>
                  Estado: {cashRegister.isOpen ? 'Caja Abierta' : 'Caja Cerrada'}
                </span>
                {cashRegister.isOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRealCashInput(cashRegister.currentCash.toString());
                      setIsCorteModalOpen(true);
                    }}
                    className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-xs rounded-xl shadow cursor-pointer transition uppercase tracking-wider"
                  >
                    Corte de Caja (Cierre de Turno)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpeningCashInput('500');
                      setIsOpeningCajaModalOpen(true);
                    }}
                    className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-750 hover:from-indigo-700 hover:to-indigo-800 text-white font-extrabold text-xs rounded-xl shadow cursor-pointer transition uppercase tracking-wider animate-pulse"
                  >
                    Realizar Apertura de Caja
                  </button>
                )}
              </div>

              {/* Monthly Cut / Statement PDF export */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 text-left">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
                      Corte Mensual (PDF)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Descarga el estado de cuenta de ventas de un mes completo — incluye cualquier mes anterior con historial disponible.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pdfCutMonth}
                      onChange={(e) => setPdfCutMonth(e.target.value)}
                      className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-400 cursor-pointer"
                    >
                      {availableStatsMonths.map(m => (
                        <option key={m} value={m}>{getMonthLabel(m)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleDownloadMonthlyCutPdf}
                      className="px-4 py-2.5 text-white font-black text-xs rounded-xl shadow-md flex items-center space-x-2 transition cursor-pointer whitespace-nowrap"
                      style={{ backgroundColor: 'var(--brand-primary)' }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar PDF</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Sales Invoice history list and Cash register details */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-6 text-left">
                <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-slate-100 gap-4">
                  <div>
                    <h2 className="text-xl font-extrabold text-slate-800">Historial & Control de Caja</h2>
                    <p className="text-xs text-slate-500 mt-1">Inspecciona y revisa el listado completo de flujos de efectivo, ventas, egresos y cancelaciones correspondientes a esta sucursal.</p>
                  </div>

                  <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setHistorySubTab('sales')}
                      className={`px-3 sm:px-4 py-2 rounded-lg font-extrabold text-xs transition cursor-pointer flex items-center whitespace-nowrap ${
                        historySubTab === 'sales'
                          ? 'bg-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      style={historySubTab === 'sales' ? { color: 'var(--brand-primary)' } : {}}
                    >
                      <Receipt className="w-3.5 h-3.5 mr-1 text-slate-400" />
                      <span>Ventas ({branchScopedSales.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistorySubTab('cashLog')}
                      className={`px-3 sm:px-4 py-2 rounded-lg font-extrabold text-xs transition cursor-pointer flex items-center whitespace-nowrap ${
                        historySubTab === 'cashLog'
                          ? 'bg-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      style={historySubTab === 'cashLog' ? { color: 'var(--brand-primary)' } : {}}
                    >
                      <CircleDollarSign className="w-3.5 h-3.5 mr-1 text-slate-400" />
                      <span className="sm:hidden">Caja ({branchScopedTransactions.length})</span>
                      <span className="hidden sm:inline">Auditoría de Caja ({branchScopedTransactions.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistorySubTab('inventory')}
                      className={`px-3 sm:px-4 py-2 rounded-lg font-extrabold text-xs transition cursor-pointer flex items-center whitespace-nowrap ${
                        historySubTab === 'inventory'
                          ? 'bg-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      style={historySubTab === 'inventory' ? { color: 'var(--brand-primary)' } : {}}
                    >
                      <Package className="w-3.5 h-3.5 mr-1 text-slate-400" />
                      <span>Inventario ({branchScopedStockMovements.length})</span>
                    </button>
                  </div>
                </div>

                {historySubTab === 'sales' ? (
                  branchScopedSales.length === 0 ? (
                    <div className="border border-dashed rounded-xl p-12 text-center text-slate-400">
                      <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-semibold">Aún no hay transacciones de ventas registradas hoy en esta sucursal.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {branchScopedSales.map(sale => (
                        <div key={sale.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/10 hover:border-slate-300 transition duration-150">
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-3 border-b border-slate-100 gap-2 mb-3">
                            <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                              <span className="text-xs font-black text-slate-800 bg-slate-100 border px-2.5 py-1 rounded-md">{sale.id}</span>
                              <span className="text-xs text-slate-500 font-medium">{sale.timestamp}</span>
                              {sale.folio && (
                                <span className="text-[10px] font-bold bg-amber-50 text-indigo-805 border border-indigo-200 px-2 py-0.5 rounded-md">
                                  Folio: {sale.folio}
                                </span>
                              )}
                            </div>
                            
                            <div className="flex items-center space-x-2">
                              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                                sale.status === 'Completed' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                  : 'bg-pink-50 text-pink-700 border-pink-200'
                              }`}>
                                {sale.status === 'Completed' ? 'Venta Exitosa' : 'Reembolsada'}
                              </span>
                              <span className="text-xs font-bold bg-slate-100 border text-slate-600 px-2 py-1 rounded">
                                Método: {sale.paymentMethod === 'Cash' ? 'Efectivo' : sale.paymentMethod === 'Card' ? 'Tarjeta' : sale.paymentMethod === 'Transfer' ? 'Transferencia' : 'Crédito/Fiado'}
                              </span>
                            </div>
                          </div>

                          {/* Invoice detailed articles list */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <p className="text-[10px] text-slate-400 font-extrabold uppercase">Artículos Incluidos</p>
                              {sale.items.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-xs text-slate-700 font-semibold">
                                  <span>{it.quantity}x {it.name}</span>
                                  <span className="text-slate-500">{formatMXN(it.salePrice * it.quantity)}</span>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-2 md:text-right bg-slate-50 p-3 rounded-xl border border-slate-100">
                              {sale.customerName && (
                                <p className="text-xs text-slate-600 font-bold">Cliente: <span style={{ color: 'var(--brand-primary)' }}>{sale.customerName}</span></p>
                              )}
                              {sale.employeeName && (
                                <p className="text-xs text-slate-600 font-bold">Atendido por: <span style={{ color: 'var(--brand-primary)' }}>{sale.employeeName}</span></p>
                              )}
                              <div className="text-xs text-slate-500 font-medium leading-relaxed">
                                <p>Subtotal: {formatMXN(sale.subtotal)}</p>
                                {sale.discount > 0 && <p className="text-emerald-600">Descuento: -{formatMXN(sale.discount)}</p>}
                                <p>Impuesto: {formatMXN(sale.tax)}</p>
                                <p className="text-base font-black text-slate-800 mt-1">Total Generado: {formatMXN(sale.total)}</p>
                              </div>

                              <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                                {sale.status === 'Completed' && isOwnerOrAdminRole && (
                                  <button
                                    type="button"
                                    onClick={() => handleRefundSale(sale.id)}
                                    className="px-3 py-1 text-[10px] hover:bg-pink-650 hover:text-white border border-pink-200 rounded text-pink-600 font-bold cursor-pointer transition align-middle"
                                  >
                                    Devolución / Reembolso
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLastCompletedSale(sale);
                                    setLastReceivedAmount(0); // non-cash popup
                                  }}
                                  className="px-3 py-1 text-[10px] font-black bg-indigo-50 border border-indigo-150 hover:bg-indigo-600 hover:text-white rounded text-indigo-600 transition cursor-pointer flex items-center gap-1"
                                >
                                  <Download className="w-3 h-3" />Compartir / Recibo
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : historySubTab === 'cashLog' ? (
                  /* Cash audits view */
                  branchScopedTransactions.length === 0 ? (
                    <div className="border border-dashed rounded-xl p-12 text-center text-slate-400">
                      <CircleDollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-semibold">No se han registrado movimientos de flujo de caja para esta sucursal hoy.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-extrabold uppercase tracking-wider">Monto Efectivo Estimado en Caja Física:</span>
                        <span className="font-extrabold text-indigo-700 text-sm">{formatMXN(cashRegister.currentCash)}</span>
                      </div>
                      <div className="space-y-2.5">
                        {branchScopedTransactions.map((tx, idx) => {
                          const isGreen = tx.type === 'Ingreso' || tx.type === 'Venta';
                          const isTransfer = tx.type === 'Transferencia';
                          return (
                            <div key={idx} className="flex justify-between items-center border border-slate-100 rounded-xl p-3 bg-white hover:bg-slate-50/50 transition duration-150">
                              <div className="flex items-center space-x-3 text-left">
                                <span className={`p-2 rounded-lg font-black text-sm flex items-center justify-center ${
                                  tx.type === 'Venta'
                                    ? 'bg-blue-50 text-blue-600'
                                    : tx.type === 'Ingreso'
                                    ? 'bg-emerald-50 text-emerald-600'
                                    : isTransfer
                                    ? 'bg-sky-50 text-sky-600'
                                    : 'bg-rose-50 text-rose-600'
                                }`}>
                                  {tx.type === 'Venta' ? <Receipt className="w-4 h-4" /> : tx.type === 'Ingreso' ? <ArrowDownCircle className="w-4 h-4" /> : isTransfer ? <RefreshCw className="w-4 h-4" /> : <ArrowUpCircle className="w-4 h-4" />}
                                </span>
                                <div>
                                  <p className="text-xs font-bold text-slate-805">{tx.description}</p>
                                  <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-semibold mt-0.5">
                                    <span>Hora: {tx.time}</span>
                                    <span>•</span>
                                    <span className="uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">
                                      {tx.type === 'Venta' ? 'Venta' : tx.type === 'Ingreso' ? 'Entrada' : isTransfer ? 'Transferencia' : 'Salida'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={`font-black text-xs ${isGreen ? 'text-emerald-600' : isTransfer ? 'text-sky-600' : 'text-rose-600'}`}>
                                  {tx.type === 'Egreso' ? '-' : isTransfer ? '' : '+'}{formatTxAmount(tx)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                ) : (
                  /* Inventory movements view (surtidos + transfers) */
                  branchScopedStockMovements.length === 0 ? (
                    <div className="border border-dashed rounded-xl p-12 text-center text-slate-400">
                      <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-semibold">Aún no hay movimientos de inventario (surtidos o traspasos) en esta sucursal.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {branchScopedStockMovements.map(mv => {
                        const isIn = mv.type === 'surtido' || mv.type === 'transfer_in';
                        const typeLabel = mv.type === 'surtido' ? 'Surtido' : mv.type === 'merma' ? 'Merma / Ajuste' : mv.type === 'transfer_in' ? 'Traspaso (entrada)' : 'Traspaso (salida)';
                        const icon = mv.type === 'surtido' ? <ArrowDownCircle className="w-4 h-4" /> : mv.type === 'merma' ? <TrendingDown className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />;
                        return (
                          <div key={mv.id} className="flex justify-between items-center border border-slate-100 rounded-xl p-3 bg-white hover:bg-slate-50/50 transition duration-150">
                            <div className="flex items-center space-x-3 text-left min-w-0">
                              <span className={`p-2 rounded-lg font-black text-sm flex items-center justify-center shrink-0 ${
                                mv.type === 'surtido' ? 'bg-emerald-50 text-emerald-600' : mv.type === 'merma' ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'
                              }`}>
                                {icon}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 truncate">{mv.productName}</p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-semibold mt-0.5 flex-wrap">
                                  <span className="uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">{typeLabel}</span>
                                  {mv.counterpartBranchName && <span>{isIn ? 'desde' : 'hacia'} {mv.counterpartBranchName}</span>}
                                  <span>{mv.timestamp}</span>
                                  {mv.userName && <span>· {mv.userName}</span>}
                                </div>
                              </div>
                            </div>
                            <span className={`font-black text-xs shrink-0 ml-2 ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {isIn ? '+' : '-'}{mv.quantity} u.
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            activeCompanyRole === 'employee' ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6 max-w-2xl mx-auto mt-6 text-center select-none">
                <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto border border-rose-100">
                  <ShieldCheck className="w-8 h-8 text-rose-500 animate-pulse" />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">Acceso Limitado a Estadísticas</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">
                    El reporte detallado de estadísticas de ganancias, ticket promedio e informes contables generales está restringido para cuentas de tipo <strong>Empleado</strong>.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border text-left max-w-md mx-auto">
                  <p className="text-xs text-slate-500 leading-relaxed text-center font-medium flex items-start gap-1.5">
                    <Settings className="w-3.5 h-3.5 shrink-0 mt-0.5" />Si necesitas acceso para reabastecimientos, reportajes o auditorías, por favor solicita a tu Administrador o Propietario que actualice tus privilegios de acceso desde la pestaña de <strong>Mi Empresa / Equipo</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
              
              {/* Core Analytics Header with Download button */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white border border-slate-200 p-6 rounded-3xl shadow-xs text-left">
                <div>
                  <h2 className="text-lg font-black text-slate-805 tracking-tight flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Centro de Estadísticas de {userCompanies[activeCompanyId || '']?.name || 'Mi Comercio'}
                  </h2>
                  <p className="text-xs text-slate-500">Métricas completas, ganancias aproximadas y tickets logrados por mes.</p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                  <select
                    value={statsMonth}
                    onChange={(e) => setStatsMonth(e.target.value)}
                    className="w-full sm:w-auto text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-400 cursor-pointer"
                  >
                    <option value="all">Todo el histórico</option>
                    {availableStatsMonths.map(m => (
                      <option key={m} value={m}>{getMonthLabel(m)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleDownloadDashboard}
                    className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /><span>Descargar Reporte (CSV)</span>
                  </button>
                </div>
              </div>

              {/* Core Analytics Dashboard summary header */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                
                <div className="bg-white rounded-2xl p-4 border shadow-sm">
                  <div className="text-slate-400 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                    Ingreso Bruto
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-2xl font-extrabold text-slate-800 mt-2">{formatMXN(stats.grossRevenue)}</p>
                  <p className="text-[10px] text-slate-550 mt-2">Ventas finalizadas con éxito</p>
                </div>

                <div className="bg-white rounded-2xl p-4 border shadow-sm">
                  <div className="text-slate-400 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                    Ganancia Est.
                    <CircleDollarSign className="w-4 h-4 text-purple-500" />
                  </div>
                  <p className="text-2xl font-extrabold text-emerald-600 mt-2">{formatMXN(stats.profit)}</p>
                  <p className="text-[10px] text-slate-500 mt-2">Diferencia entre Costo y Cierre</p>
                </div>

                <div className="bg-white rounded-2xl p-4 border shadow-sm">
                  <div className="text-slate-400 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                    Ticket Promedio
                    <ShoppingCart className="w-4 h-4 text-slate-400" />
                  </div>
                  <p className="text-2xl font-extrabold text-slate-800 mt-2">{formatMXN(stats.averageTicket)}</p>
                  <p className="text-[10px] text-slate-500 mt-2">Total dividido nro ventas</p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-dashed border-amber-200 bg-amber-50/10">
                  <div className="text-amber-600 font-bold text-xs uppercase tracking-wider flex items-center justify-between">
                    Riesgo Stock Bajo
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                  </div>
                  <p className="text-2xl font-extrabold text-amber-700 mt-2">{stats.lowStockItems.length} Prod.</p>
                  <p className="text-[10px] text-slate-500 mt-2">Artículos por debajo del mínimo</p>
                </div>

              </div>

              {/* Graphical Charts Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Sale split by Category Bar graphical card */}
                <div className="bg-white rounded-2xl border p-5 shadow-sm space-y-4">
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-sm">Distribución de Ventas por Categoría</h3>
                    <p className="text-slate-400 text-xs mt-0.5">Demanda acumulada según las categorías de productos.</p>
                  </div>

                  {Object.keys(stats.categoryPopularity).length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">Sin datos de transacciones para diagramar barras de popularidad</div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(stats.categoryPopularity).map(([cat, val]) => {
                        const valuesArray = Object.values(stats.categoryPopularity) as number[];
                        const maxVal = Math.max(...valuesArray);
                        const numVal = val as number;
                        const pctWidth = maxVal > 0 ? (numVal / maxVal) * 100 : 0;
                        return (
                          <div key={cat} className="space-y-1">
                            <div className="flex justify-between text-xs font-bold text-slate-705">
                              <span>{cat}</span>
                              <span className="text-indigo-600">{val} uds. vendidas</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-lg h-2.5 overflow-hidden">
                              <div 
                                className="bg-indigo-600 h-2.5 rounded-lg transition-all duration-500"
                                style={{ width: `${pctWidth}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* List Low Stock Alerts with action shortcut */}
                <div className="bg-white rounded-2xl border p-5 shadow-sm space-y-4">
                  <div>
                    <h3 className="font-extrabold text-purple-650 text-sm flex items-center">
                      <AlertCircle className="w-4 h-4 mr-1 text-purple-500 animate-bounce" />
                      Alertas de Reabastecimiento Crítico
                    </h3>
                    <p className="text-slate-400 text-xs mt-0.5">Surtidos indispensables por debajo del umbral mínimo de reserva.</p>
                  </div>

                  {stats.lowStockItems.length === 0 ? (
                    <p className="text-xs text-slate-500 font-semibold py-8 text-center flex items-center justify-center gap-1.5"><Check className="w-4 h-4" />El almacén está perfectamente abastecido de mercancías.</p>
                  ) : (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {stats.lowStockItems.map(p => (
                        <div key={p.id} className="bg-slate-50 border border-slate-100 flex justify-between items-center p-2.5 rounded-xl">
                          <div>
                            <p className="text-xs font-bold text-slate-850">{p.name}</p>
                            <p className="text-[9px] text-slate-400">Mínimo sugerido: {p.minStock}</p>
                          </div>
                          <div className="text-right">
                            <span className="px-2 py-0.5 font-extrabold text-[10px] rounded-full text-white" style={{ backgroundColor: 'var(--brand-primary)' }}>
                              Stock: {getProductStock(p, selectedBranchId)}
                            </span>
                            <button
                              onClick={() => handleOpenRestock(undefined, p.id)}
                              className="text-[9px] underline block mt-1 font-bold font-mono"
                              style={{ color: 'var(--brand-primary)' }}
                            >
                              Surtir +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

            </div>
            )
          )}

          {/* SCREEN: SUCURSALES (BRANCH OFFICES) */}
          {activeTab === 'branches' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border shadow-sm">
                <div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center">
                    <Store className="w-5 h-5 mr-2 text-teal-650" />
                    Control de Sucursales y Oficinas
                  </h2>
                  <p className="text-slate-500 text-xs mt-1">
                    Administra múltiples ubicaciones físicas o móviles, asigna gerentes, y monitorea el rendimiento individual.
                  </p>
                </div>
                {activeCompanyRole !== 'employee' && (
                  <div className="flex gap-2.5 w-full md:w-auto self-start flex-wrap">
                    {branches.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleOpenTransferModal()}
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer transition flex items-center justify-center space-x-2"
                        title="Distribuir existencias desde casa matriz o de una sucursal a otra"
                      >
                        <Package className="w-3.5 h-3.5" /><span>Transferir / Repartir Stock</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenBranchModal()}
                      className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer transition flex items-center justify-center space-x-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Registrar Sucursal</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Grid of branches cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {branches.map(branch => {
                  const isActive = selectedBranchId === branch.id;
                  const totalBranchRevenue = branchRevenueStats[branch.id]?.revenue ?? 0;
                  const branchSalesCount = branchRevenueStats[branch.id]?.count ?? 0;

                  return (
                    <div 
                      key={branch.id} 
                      className={`relative bg-white rounded-3xl p-5 border shadow-sm flex flex-col justify-between transition group hover:shadow-md ${
                        isActive ? 'border-teal-500 ring-4 ring-teal-500/10' : 'border-slate-200'
                      }`}
                    >
                      {isActive && (
                        <span className="absolute top-4 right-4 bg-teal-100 border border-teal-200 text-teal-850 text-[9px] font-black uppercase px-2 py-0.5 rounded-full select-none">
                          Trabajando Aquí
                        </span>
                      )}

                      <div className="space-y-4">
                        <div className="flex items-start space-x-3">
                          <div className={`p-2.5 rounded-2xl ${isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                            <Building2 className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-extrabold text-slate-800 text-sm group-hover:text-teal-700 transition">{branch.name}</h3>
                            <p className="text-slate-400 text-[10px] mt-0.5 font-mono">ID: {branch.id}</p>
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-slate-100 pt-3 text-xs leading-relaxed">
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Dirección:</span>
                            <span className="font-semibold text-slate-705 max-w-[150px] truncate" title={branch.address}>{branch.address || 'Sin registrar'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Teléfono:</span>
                            <span className="font-semibold text-slate-705">{branch.phone || 'Sin registrar'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Gerente / Resp:</span>
                            <span className="font-semibold text-teal-700">{branch.manager || 'No asignado'}</span>
                          </div>
                        </div>

                        {/* Performance metrics inside each card */}
                        <div className="bg-slate-50 border border-slate-100 p-3 rounded-2xl space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                            <span>Ingresos Sucursal:</span>
                            <span className="text-slate-800 font-mono">{formatMXN(totalBranchRevenue)}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div 
                              className="bg-teal-500 h-1.5 rounded-full" 
                              style={{ width: `${Math.min(100, (totalBranchRevenue / (stats.grossRevenue || 1)) * 100)}%` }}
                            ></div>
                          </div>
                          <p className="text-[9px] text-slate-400 text-right mt-1 font-semibold">{branchSalesCount} transacciones exitosas</p>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        {!isActive ? (
                          <button
                            onClick={() => handleSelectBranch(branch.id)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-teal-50 hover:text-teal-700 border border-slate-250 hover:border-teal-200 text-slate-700 font-bold rounded-lg cursor-pointer transition text-[10px]"
                          >
                            Hacer Activa
                          </button>
                        ) : (
                          <span className="text-teal-600 font-bold text-[10px] flex items-center">
                            <Check className="w-3.5 h-3.5 mr-1 bg-teal-100 rounded-full p-0.5" /> Selección Actual
                          </span>
                        )}

                        {activeCompanyRole !== 'employee' ? (
                          <div className="flex space-x-1">
                            <button
                              onClick={() => handleOpenBranchModal(branch)}
                              className="p-1 px-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition font-semibold text-[10px] border border-transparent hover:border-slate-200"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleDeleteBranch(branch.id)}
                              className="p-1 px-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition font-semibold text-[10px]"
                              title="Eliminar Sucursal"
                            >
                              Eliminar
                            </button>
                          </div>
                        ) : (
                          <span className="text-[9px] text-slate-400 font-bold select-none py-1 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />Solo Admins
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SCREEN: PROVEEDORES (SUPPLIERS CATALOG) */}
          {activeTab === 'suppliers' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border shadow-sm">
                <div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center">
                    <Truck className="w-5 h-5 mr-2 text-amber-653 animate-bounce" />
                    Catálogo de Proveedores de Insumos
                  </h2>
                  <p className="text-slate-500 text-xs mt-1">
                    Gobernanza de distribuidores. Contacta proveedores directos y reabastece stock registrando egresos en caja.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                  <button
                    onClick={() => handleOpenRestock()}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer transition flex items-center justify-center space-x-2"
                  >
                    <ArrowLeft className="w-4 h-4 rotate-180" />
                    <span>Reabastecer / Surtir Almacén</span>
                  </button>
                  {activeCompanyRole !== 'employee' && (
                    <button
                      onClick={() => handleOpenSupplierModal()}
                      className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer transition flex items-center justify-center space-x-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Registrar Proveedor</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Grid of Suppliers cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {suppliers.map(supplier => {
                  const linkedProducts = products.filter(p => p.supplierId === supplier.id);

                  return (
                    <div key={supplier.id} className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition group">
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <div className="p-2.5 bg-amber-50 text-amber-700 rounded-2xl group-hover:bg-amber-100 transition">
                              <Truck className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="font-extrabold text-slate-800 text-sm group-hover:text-amber-700 transition">{supplier.name}</h3>
                              <p className="text-slate-400 text-[9px] font-mono mt-0.5">Categoría: <span className="text-amber-700 font-bold bg-amber-50 border border-amber-100 px-1.5 py-0.2 rounded-md">{supplier.category}</span></p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-slate-105 pt-3 text-xs leading-relaxed">
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Contacto:</span>
                            <span className="font-semibold text-slate-705">{supplier.contactName || 'Sin registrar'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Teléfono:</span>
                            <span className="font-semibold text-slate-705 font-mono">{supplier.phone || 'Sin registrar'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Email:</span>
                            <span className="font-semibold text-indigo-600 font-mono truncate max-w-[140px]" title={supplier.email}>{supplier.email || 'Sin registrar'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400 font-bold uppercase text-[9px]">Dirección:</span>
                            <span className="font-semibold text-slate-705 max-w-[150px] truncate" title={supplier.address}>{supplier.address || 'Sin registrar'}</span>
                          </div>
                        </div>

                        {/* Associated Products metrics */}
                        <div className="bg-amber-50/20 border border-amber-105/40 p-3 rounded-2xl">
                          <div className="flex justify-between items-center text-xs font-bold text-slate-705">
                            <span>Productos Surtidos:</span>
                            <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full text-[10px] font-black">{linkedProducts.length} artículos</span>
                          </div>
                          {linkedProducts.length > 0 && (
                            <div className="mt-2 text-[10px] text-slate-500 leading-tight space-y-1">
                              <p className="font-bold border-b border-amber-100 pb-1 uppercase text-[8px] text-slate-400">Existencias Actuales:</p>
                              {linkedProducts.slice(0, 3).map(p => (
                                <div key={p.id} className="flex justify-between font-medium">
                                  <span>{p.name}</span>
                                  <span className={`font-mono font-bold ${p.stock <= p.minStock ? 'text-orange-500' : 'text-slate-700'}`}>Stock: {p.stock}</span>
                                </div>
                              ))}
                              {linkedProducts.length > 3 && (
                                <p className="text-[9px] text-indigo-500 font-bold select-none cursor-pointer hover:underline" onClick={() => setActiveTab('products')}>+ {linkedProducts.length - 3} artículos más...</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <button
                          onClick={() => {
                            if (linkedProducts.length === 0) {
                              alert('Registre o vincule productos a este proveedor en el Inventario antes de reabastecer.');
                              return;
                            }
                            handleOpenRestock(supplier.id, linkedProducts[0].id);
                          }}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 font-bold rounded-lg text-white cursor-pointer transition text-[10px] shadow-sm"
                        >
                          Surtir Productos
                        </button>

                        {activeCompanyRole !== 'employee' ? (
                          <div className="flex space-x-1">
                            <button
                              onClick={() => handleOpenSupplierModal(supplier)}
                              className="p-1 px-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition font-semibold text-[10px] border border-transparent hover:border-slate-200"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleDeleteSupplier(supplier.id)}
                              className="p-1 px-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition font-semibold text-[10px]"
                              title="Eliminar Proveedor"
                            >
                              Eliminar
                            </button>
                          </div>
                        ) : (
                          <span className="text-[9px] text-slate-400 font-bold select-none py-1 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />Solo Admins
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SCREEN: FACTURACION E HISTORIAL DE TICKETS (INVOICING) */}
          {activeTab === 'invoicing' && (
            <div className="bg-white p-4 lg:p-6 rounded-3xl shadow-xl border border-slate-100 flex-grow animate-in fade-in slide-in-from-bottom-4 relative mb-24 lg:mb-8 mx-auto w-full max-w-7xl">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-5 mb-5 space-y-3 sm:space-y-0 relative z-10 w-full">
                <div>
                  <h2 className="text-xl md:text-2xl font-black text-slate-800 bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600 flex items-center gap-2">
                    <FileText className="w-8 h-8 text-blue-600" />
                    Facturación Electrónica CFDI
                  </h2>
                  <p className="text-slate-500 text-xs mt-1">
                    Gestiona las facturas pendientes por emitir y el historial de folios generados.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <select 
                    value={invoiceStatusFilter} 
                    onChange={e => setInvoiceStatusFilter(e.target.value as 'all' | 'pending' | 'completed')}
                    className="px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl text-slate-700 outline-none flex-1 sm:flex-none cursor-pointer"
                  >
                    <option value="all">Ver Todas</option>
                    <option value="pending">Solo Pendientes</option>
                    <option value="completed">Realizadas</option>
                  </select>
                </div>
              </div>

              {/* Rendering list of sales that require invoice */}
              {invoiceSales.filter(s => invoiceStatusFilter === 'all' || s.invoiceStatus === invoiceStatusFilter).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                  {invoiceSales.filter(s => invoiceStatusFilter === 'all' || s.invoiceStatus === invoiceStatusFilter).map(sale => (
                    <div key={sale.id} className="border border-slate-200 rounded-xl p-4 shadow-sm bg-white hover:border-indigo-200 transition">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-slate-700 text-sm">{sale.id}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          sale.invoiceStatus === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {sale.invoiceStatus === 'completed' ? 'Facturado' : 'Pendiente'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mb-2">
                        <div>Cliente: <span className="font-bold">{sale.customerName || 'Público General'}</span></div>
                        <div>Fecha: {sale.timestamp}</div>
                        <div className="mt-1 font-bold">Conceptos:</div>
                        <div className="bg-slate-50 p-2 rounded truncate overflow-hidden text-[10px] border border-slate-100 mt-1">
                          {sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-100">
                        <span className="text-xs font-black text-slate-800">Total: {formatMXN(sale.total)}</span>
                        {sale.invoiceStatus !== 'completed' && (
                          <button
                            onClick={() => handleSetInvoiceStatus(sale.id, 'completed')}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm"
                          >
                            Marcar Facturado
                          </button>
                        )}
                        {sale.invoiceStatus === 'completed' && (
                          <button
                            onClick={() => handleSetInvoiceStatus(sale.id, 'pending')}
                            className="text-slate-400 hover:text-slate-600 underline text-[10px] font-bold p-1"
                          >
                            Revertir
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-50/50 rounded-2xl border border-slate-100 p-8 flex flex-col items-center justify-center text-center space-y-4 mt-6 min-h-[50vh]">
                  <FileText className="w-20 h-20 text-indigo-200" />
                  <h3 className="text-xl font-black text-slate-700 tracking-tight">Módulo de Facturación Electrónica</h3>
                  <p className="text-slate-500 text-sm max-w-md">
                    No hay facturas que coincidan con tu búsqueda.<br/>
                    Aquí aparecerán las ventas marcadas para facturar.
                  </p>
                  <div className="text-[11px] bg-amber-50 text-amber-700 px-4 py-3 rounded-xl border border-amber-200 mt-4 font-bold max-w-md shadow-sm flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />El proceso de timbrado CFDI (facturación) requerirá registrar las credenciales y certificados (CSD) del SAT en la configuración avanzada. Esta es la pre-vista del módulo de control interno.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SCREEN: AUDITORÍA (owner/admin/master_admin only — gated at the nav level above) */}
          {activeTab === 'audit' && (
            <AuditView
              companyName={branding.displayName || userCompanies[activeCompanyId || '']?.name || 'Mi Comercio'}
              sales={auditSales}
              orders={orders}
              cashRegisters={allCashRegisters}
              branches={branches}
              members={members}
            />
          )}

          {/* SCREEN: EMPRESA Y EQUIPO (SETTINGS) */}
          {activeTab === 'settings' && (
            (!user || !activeCompanyId) ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6 max-w-2xl mx-auto mt-6 text-center">
                <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto border border-rose-100">
                  <Settings className="w-8 h-8 text-rose-500 animate-spin-slow" />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">Configuración de Empresa y Nube</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">
                    Para activar la gestión de sucursales, control de roles (Propietario, Admin, Empleado) y sincronización de inventario con tu equipo, es necesario conectar tu cuenta.
                  </p>
                </div>

                <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100/60 text-left space-y-3.5">
                  <h4 className="font-bold text-slate-800 text-xs sm:text-sm flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                    Beneficios de Activar la Sincronización en la Nube:
                  </h4>
                  <ul className="text-[11px] sm:text-xs text-slate-600 space-y-2.5 pl-1">
                    <li className="flex items-start gap-1.5">
                      <span className="text-indigo-600 font-bold"><Check className="w-3.5 h-3.5" /></span>
                      <span><strong>Multi-Sucursal</strong>: Configura sucursales físicas y asigna inventario de catálogo independiente de sucursales.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-indigo-600 font-bold"><Check className="w-3.5 h-3.5" /></span>
                      <span><strong>Control de Roles</strong>: Propietario (dueño general), Administrador (edición/inventario), Cajero (caja e inventario limitado), Mesero (mesas y comandas).</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-indigo-600 font-bold"><Check className="w-3.5 h-3.5" /></span>
                      <span><strong>Acceso con Código</strong>: Genera códigos únicos estilo invitación para que tus colaboradores entren con un clic.</span>
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                  {/* `user` is always set here — the login gate already returned early otherwise. */}
                  <div className="space-y-4 w-full">
                    <p className="text-xs text-amber-600 font-semibold bg-amber-50 rounded-lg p-2.5 inline-flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />Estás conectado como {user.email} pero no tienes ninguna Empresa activa.
                    </p>
                    <button
                      onClick={() => {
                        // Allow choosing / creating a company - clear any storage and let screen display selection
                        localStorage.removeItem(`logic_active_company_${user.uid}`);
                        setActiveCompanyId(null);
                      }}
                      className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm rounded-xl shadow-md cursor-pointer transition flex items-center justify-center space-x-2 mx-auto"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>Abrir Panel de Selección de Empresa</span>
                    </button>
                  </div>
                </div>

                {/* Local actions catalog */}
                <div className="pt-6 border-t border-slate-100 flex flex-col items-center gap-3">
                  <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Acciones Locales</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (confirm('¿Desea restablecer todos los productos y ventas locales a los valores por defecto del sistema?')) {
                          localStorage.clear();
                          window.location.reload();
                        }
                      }}
                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-250 text-slate-600 hover:text-slate-800 text-xs font-bold rounded-lg cursor-pointer transition"
                    >
                      Restablecer Base de Datos Local
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // When user is authenticated AND has an activeCompanyId successfully connected
              <CompanySettingsView
                companyId={activeCompanyId}
                companyName={userCompanies[activeCompanyId]?.name || 'Mi Comercio'}
                currentUserRole={activeCompanyRole}
                currentUserId={user.uid}
                userAvailableCompanies={userCompanies}
                kioskCompanyId={kioskCompanyId}
                onBindKiosk={handleBindKiosk}
                onUnbindKiosk={handleUnbindKiosk}
                onSwitchCompany={(id) => {
                  localStorage.setItem(`logic_active_company_${user.uid}`, id);
                  setActiveCompanyId(id);
                  setActiveTab('pos');
                }}
                onLogoutCompany={() => signOut(auth)}
                onCreateCompany={handleCreateCompany}
                branches={branches}
                products={products}
                sales={sales}
                suppliers={suppliers}
                customers={customers}
                customCategories={customCategories}
                onGoogleSignInForBackup={async () => {
                  try {
                    if (isNativePlatform) {
                      // On native, user is already signed in via redirect — return cached token
                      return getCachedAccessToken();
                    }
                    // Uses the Drive-scoped provider — this is the only place the app
                    // requests Google Drive access, kept separate from the everyday login.
                    const result = await signInWithPopup(auth, driveGoogleProvider);
                    const credential = GoogleAuthProvider.credentialFromResult(result);
                    if (credential?.accessToken) {
                      setCachedAccessToken(credential.accessToken);
                      return credential.accessToken;
                    }
                    return null;
                  } catch (e) {
                    console.error("Popup login error in setting sync:", e);
                    throw e;
                  }
                }}
                onFetchAllSalesForBackup={async () => {
                  if (!activeCompanyId) return [];
                  const snap = await getDocs(collection(db, 'companies', activeCompanyId, 'sales'));
                  const list: Sale[] = [];
                  snap.forEach(d => list.push(d.data() as Sale));
                  return list;
                }}
                onRestoreCompanyData={handleRestoreCompanyData}
                branding={branding}
                onSaveBranding={async (newBranding: Branding) => {
                  if (!activeCompanyId) return;
                  const isValidHex = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
                  // Strip undefined/empty values; also reject malformed hex colors
                  const cleaned = Object.fromEntries(
                    Object.entries(newBranding).filter(([k, v]) => {
                      if (v === undefined || v === '') return false;
                      if (['primaryColor','accentColor','darkColor'].includes(k)) return isValidHex(v);
                      return true;
                    })
                  );
                  await setDoc(doc(db, 'companies', activeCompanyId, 'settings', 'branding'), cleaned, { merge: true });
                }}
                printConfig={printConfig}
                onSavePrintConfig={async (newConfig: PrintConfig) => {
                  if (!activeCompanyId) return;
                  await setDoc(doc(db, 'companies', activeCompanyId, 'settings', 'printConfig'), newConfig, { merge: true });
                }}
                isNativePlatform={isNativePlatform}
                bluetoothPrinter={bluetoothPrinter}
                onScanBluetoothPrinters={handleScanBluetoothPrinters}
                onSelectBluetoothPrinter={saveBluetoothPrinter}
                onTestPrintBluetooth={handleTestPrintBluetooth}
                webUsbSupported={isWebUsbSupported()}
                webBluetoothSupported={isWebBluetoothSupported()}
                webPrinterInfo={webPrinterInfo}
                onConnectWebUsbPrinter={handleConnectWebUsbPrinter}
                onConnectWebBluetoothPrinter={handleConnectWebBluetoothPrinter}
                onForgetWebPrinter={handleForgetWebPrinter}
                onTestPrintWeb={handleTestPrintWeb}
                isCredentialEmployee={isCredentialEmployee}
              />
            )
          )}

        </main>
      </div>

      {/* MODAL WINDOW: CREAR/EDITAR PRODUCTO */}
      {quickStockProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600" /> Surtir Stock
              </h3>
              <button
                onClick={() => { setQuickStockProduct(null); setQuickStockAmount(''); }}
                className="p-1.5 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-sm space-y-1">
              <p className="font-extrabold text-slate-800">{quickStockProduct.name}</p>
              <p className="text-xs text-slate-500">
                Sucursal: <span className="font-bold text-slate-700">{branches.find(b => b.id === selectedBranchId)?.name || 'Actual'}</span>
              </p>
              <p className="text-xs text-slate-500">
                Stock actual: <span className="font-bold text-slate-700">{getProductStock(quickStockProduct, selectedBranchId)} u.</span>
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 block">Unidades a agregar</label>
              <input
                type="number"
                autoFocus
                placeholder="Ej: 20"
                value={quickStockAmount}
                onChange={e => setQuickStockAmount(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isSavingQuickStock) handleQuickAddStock(); }}
                className="w-full text-lg font-black text-center bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-slate-400 text-center">Se suma al stock existente (usa negativo para descontar una merma).</p>
            </div>

            {quickStockAmount && !isNaN(parseInt(quickStockAmount)) && parseInt(quickStockAmount) !== 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-center text-xs font-bold text-emerald-800">
                Nuevo stock: {getProductStock(quickStockProduct, selectedBranchId)} → {Math.max(0, getProductStock(quickStockProduct, selectedBranchId) + parseInt(quickStockAmount))} u.
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setQuickStockProduct(null); setQuickStockAmount(''); }}
                className="w-1/3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingQuickStock}
                onClick={handleQuickAddStock}
                className="w-2/3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl cursor-pointer transition disabled:opacity-50"
              >
                {isSavingQuickStock ? 'Guardando...' : 'Agregar al Stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isProductModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-xl text-slate-800">
                {editingProduct ? 'Editar Producto del Catálogo' : 'Crear Nuevo Producto POS'}
              </h3>
              <button 
                onClick={() => setIsProductModalOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">Nombre del Artículo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Sándwich de Pavita"
                    value={prodForm.name}
                    onChange={e => setProdForm({ ...prodForm, name: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">Categoría de Alimento / General</label>
                  {newCatPrompt ? (
                    <div className="flex items-center gap-2">
                       <input 
                         autoFocus
                         type="text" 
                         value={newCatName}
                         onChange={e => setNewCatName(e.target.value)}
                         placeholder="Nueva categoría..."
                         className="w-full text-xs bg-white border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                       />
                       <button
                         type="button"
                         onClick={() => {
                           if (newCatName.trim()) {
                             setProdForm({ ...prodForm, category: newCatName.trim() });
                           }
                           setNewCatPrompt(false);
                         }}
                         aria-label="Confirmar categoría"
                         className="bg-indigo-600 text-white px-3 py-2 rounded-lg font-bold text-xs hover:bg-indigo-700"
                       >
                         <Check className="w-3.5 h-3.5" />
                       </button>
                       <button
                         type="button"
                         onClick={() => setNewCatPrompt(false)}
                         className="bg-slate-200 text-slate-600 px-3 py-2 rounded-lg font-bold text-xs"
                       >
                         X
                       </button>
                    </div>
                  ) : (
                    <select
                      value={prodForm.category || DEFAULT_PRODUCT_CATEGORY}
                      onChange={e => {
                        if (e.target.value === '__new__') {
                          setNewCatName('');
                          setNewCatPrompt(true);
                        } else {
                          setProdForm({ ...prodForm, category: e.target.value });
                        }
                      }}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-55 font-bold text-slate-700"
                    >
                      {!prodForm.category && <option value="">-- Seleccionar Categoría --</option>}
                      {selectCategoriesList.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="__new__" className="text-indigo-600 font-bold">+ Crear Nueva Categoría...</option>
                    </select>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">Costo de Producción / Proveedor ($)</label>
                  <input 
                    type="number"
                    step="0.01"
                    placeholder="Ej: 1.50"
                    value={prodForm.costPrice}
                    onChange={e => setProdForm({ ...prodForm, costPrice: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">Precio de Caja Registradora ($) *</label>
                  <input 
                    type="number"
                    step="0.01"
                    required
                    placeholder="Ej: 4.99"
                    value={prodForm.salePrice}
                    onChange={e => setProdForm({ ...prodForm, salePrice: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">Stock Inicial en Almacén</label>
                  <input 
                    type="number"
                    placeholder="Ej: 20"
                    value={prodForm.stock}
                    onChange={e => setProdForm({ ...prodForm, stock: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 block">Alerta de Stock Mínimo Crítico</label>
                  <input 
                    type="number"
                    placeholder="Ej: 5"
                    value={prodForm.minStock}
                    onChange={e => setProdForm({ ...prodForm, minStock: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 block">Código SKU del Producto (Opcional)</label>
                  <input 
                    type="text"
                    placeholder="Ej: SKU-92813"
                    value={prodForm.sku}
                    onChange={e => setProdForm({ ...prodForm, sku: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 block">Proveedor Vinculado (Surtido)</label>
                  <select
                    value={prodForm.supplierId}
                    onChange={e => setProdForm({ ...prodForm, supplierId: e.target.value })}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-semibold text-slate-700"
                  >
                    <option value="">-- Sin Proveedor (Ninguno) --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                    ))}
                  </select>
                </div>

                {activeCompany?.businessType === 'restaurante' && (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-bold text-slate-500 block">Destino de Impresión (Comandas)</label>
                    <select
                      value={prodForm.printDestination}
                      onChange={e => setProdForm({ ...prodForm, printDestination: e.target.value as any })}
                      className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-semibold text-slate-700"
                    >
                      <option value="ninguno">Ninguno (No imprime comanda)</option>
                      <option value="cocina">Cocina (Estación de cocina)</option>
                      <option value="barra">Barra (Estación de barra / bebidas)</option>
                    </select>
                  </div>
                )}

              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button 
                  type="button" 
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl cursor-pointer shadow"
                >
                  Guardar Artículo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: CREAR/EDITAR CLIENTE */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800">
                {editingCustomer ? 'Modificar Perfil del Cliente' : 'Registrar Nuevo Cliente'}
              </h3>
              <button onClick={() => setIsCustomerModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 bg-slate-100 rounded-full">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-4 text-xs">
              <div className="space-y-3">
                <div>
                  <label className="font-bold text-slate-500 block mb-1">Nombre Completo *</label>
                  <input 
                    type="text"
                    required
                    placeholder="Ej: Daniel José"
                    value={custForm.name}
                    onChange={e => setCustForm({ ...custForm, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-500 block mb-1 font-sans">Número Telefónico (Contacto)</label>
                  <input 
                    type="text"
                    placeholder="Ej: 555-1202"
                    value={custForm.phone}
                    onChange={e => setCustForm({ ...custForm, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-500 block mb-1">Correo Electrónico</label>
                  <input 
                    type="email"
                    placeholder="Ej: cliente@correo.com"
                    value={custForm.email}
                    onChange={e => setCustForm({ ...custForm, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t text-xs font-bold">
                <button 
                  type="button" 
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer shadow"
                >
                  Guardar Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: TRANSFERENCIA MULTI-SUCURSAL / REPARTO DESDE MATRIZ */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <Store className="w-5 h-5 mr-2 text-indigo-600" />
                <Package className="w-3.5 h-3.5 inline mr-1" /><span>Transferencia e Inventario</span>
              </h3>
              <button 
                onClick={() => setIsTransferModalOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-705 bg-slate-105 hover:bg-slate-200 rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="text-xs uppercase font-extrabold text-slate-500 tracking-wider block text-left">1. Seleccionar Artículo / Producto:</label>
                <select
                  value={transferProductId}
                  onChange={(e) => setTransferProductId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 text-xs font-bold outline-none focus:border-indigo-500 transition mt-1.5"
                >
                  <option value="">Selecciona un producto...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Stock Global: {p.stock} u. | {p.category || DEFAULT_PRODUCT_CATEGORY})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left">
                <div>
                  <label className="text-xs uppercase font-extrabold text-slate-500 tracking-wider block">2. Origen:</label>
                  <select
                    value={transferSourceBranchId}
                    onChange={(e) => setTransferSourceBranchId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-xs font-bold outline-none focus:border-indigo-500 transition mt-1.5"
                  >
                    <option value="">Selecciona origen...</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.isMatriz ? '(Matriz)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs uppercase font-extrabold text-slate-500 tracking-wider block">3. Destino / Reparto:</label>
                  <select
                    value={transferTargetBranchId}
                    onChange={(e) => setTransferTargetBranchId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-xs font-bold outline-none focus:border-indigo-500 transition mt-1.5"
                  >
                    <option value="">Selecciona destino...</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.isMatriz ? '(Matriz)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {transferProductId && transferSourceBranchId && (
                <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl text-left text-xs font-bold text-slate-600 flex items-start gap-1">
                  <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5" />Existencia actual en Sucursal de Origen:{' '}
                  <span className="text-indigo-600 font-extrabold">
                    {(() => {
                      const p = products.find(prod => prod.id === transferProductId);
                      if (!p) return 0;
                      return p.branchStocks && p.branchStocks[transferSourceBranchId] !== undefined 
                        ? p.branchStocks[transferSourceBranchId] 
                        : p.stock;
                    })()}{' '}
                    unidades.
                  </span>
                </div>
              )}

              <div>
                <label className="text-xs uppercase font-extrabold text-slate-500 tracking-wider block text-left">4. Cantidad a Transferir / Repartir:</label>
                <input
                  type="number"
                  min="1"
                  value={transferQuantity}
                  onChange={(e) => setTransferQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 text-xs font-black outline-none focus:border-indigo-500 transition mt-1.5"
                />
              </div>
            </div>

            <div className="flex gap-2.5 pt-3">
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition text-center cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteTransfer}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition text-center cursor-pointer shadow-md"
              >
                Confirmar Reparto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: REGISTRAR/EDITAR SUCURSAL */}
      {isBranchModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <Store className="w-5 h-5 mr-2 text-teal-650" />
                {editingBranch ? 'Modificar Sucursal' : 'Registrar Nueva Sucursal'}
              </h3>
              <button 
                onClick={() => setIsBranchModalOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-705 bg-slate-105 hover:bg-slate-200 rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBranch} className="space-y-4 text-xs font-semibold">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Nombre de la Sucursal *</label>
                  <input 
                    type="text"
                    required
                    placeholder="Ej: Sucursal Oriente - Express"
                    value={branchForm.name}
                    onChange={e => setBranchForm({ ...branchForm, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 font-bold text-slate-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Dirección Física</label>
                  <input 
                    type="text"
                    placeholder="Ej: Av. Central No. 420, Col. Centro"
                    value={branchForm.address}
                    onChange={e => setBranchForm({ ...branchForm, address: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Teléfono / Contacto</label>
                  <input 
                    type="text"
                    placeholder="Ej: 555-9201"
                    value={branchForm.phone}
                    onChange={e => setBranchForm({ ...branchForm, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Gerente / Responsable de Sucursal</label>
                  <select 
                    value={branchForm.manager}
                    onChange={e => setBranchForm({ ...branchForm, manager: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="">-- Selecciona un Gerente --</option>
                    {branchForm.manager && !members.filter(m => m.role === 'owner' || m.role === 'master_admin' || m.role === 'admin').some(m => m.name === branchForm.manager) && (
                      <option value={branchForm.manager}>{branchForm.manager}</option>
                    )}
                    {members.filter(m => m.role === 'owner' || m.role === 'master_admin' || m.role === 'admin').map(member => (
                      <option key={member.userId} value={member.name}>
                        {member.name} ({member.role === 'owner' ? 'Propietario' : member.role === 'master_admin' ? 'Master Admin' : 'Administrador'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1 pt-1">
                  <div className="flex items-start space-x-2.5 p-3 bg-teal-50/40 border border-teal-100 rounded-xl">
                    <input 
                      type="checkbox" 
                      id="branch-is-matriz"
                      checked={branchForm.isMatriz}
                      onChange={e => setBranchForm({ ...branchForm, isMatriz: e.target.checked })}
                      className="w-4 h-4 text-teal-600 focus:ring-teal-500 border-slate-300 rounded cursor-pointer mt-0.5"
                    />
                    <div>
                      <label htmlFor="branch-is-matriz" className="text-slate-800 font-extrabold cursor-pointer flex items-center gap-1 text-xs"><Building2 className="w-3.5 h-3.5" />Definir como Matriz Principal</label>
                      <span className="text-[10px] text-slate-500 leading-tight block font-normal">Fabrica materia prima, almacena el inventario central y permite repartir stock a otras sucursales.</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t text-xs font-bold">
                <button 
                  type="button" 
                  onClick={() => setIsBranchModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg cursor-pointer shadow-md"
                >
                  Guardar Sucursal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: REGISTRAR/EDITAR PROVEEDOR */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <Truck className="w-5 h-5 mr-2 text-amber-653" />
                {editingSupplier ? 'Modificar Proveedor' : 'Registrar Nuevo Proveedor'}
              </h3>
              <button 
                onClick={() => setIsSupplierModalOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-705 bg-slate-105 hover:bg-slate-200 rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSupplier} className="space-y-4 text-xs font-semibold">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Nombre de la Distribuidora / Marca *</label>
                  <input 
                    type="text"
                    required
                    placeholder="Ej: Carnes y Embutidos S.A."
                    value={supplierForm.name}
                    onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-amber-500 font-bold text-slate-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Nombre del Ejecutivo de Contacto</label>
                  <input 
                    type="text"
                    placeholder="Ej: Ing. Jorge Valdés"
                    value={supplierForm.contactName}
                    onChange={e => setSupplierForm({ ...supplierForm, contactName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-500 font-bold block">Teléfono de Surtido</label>
                    <input 
                      type="text"
                      placeholder="Ej: 555-8833"
                      value={supplierForm.phone}
                      onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-amber-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-500 font-bold block">Giro / Categoría Comercial</label>
                    <select
                      value={supplierForm.category}
                      onChange={e => setSupplierForm({ ...supplierForm, category: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-amber-500 text-slate-700 font-bold"
                    >
                      <option value="General">General</option>
                      <option value="Alimentos">Alimentos</option>
                      <option value="Bebidas">Bebidas</option>
                      <option value="Postres">Postres</option>
                      <option value="Insumos">Insumos</option>
                      <option value="Empaque">Empaque</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Correo de Pedidos Corporativos</label>
                  <input 
                    type="email"
                    placeholder="Ej: pedidos@distribuidora.com"
                    value={supplierForm.email}
                    onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Ubicación / Almacén del Proveedor</label>
                  <input 
                    type="text"
                    placeholder="Ej: Parque Industrial No. 12"
                    value={supplierForm.address}
                    onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                  <label className="text-slate-500 font-extrabold block">Productos que surten a este negocio:</label>
                  {products.length === 0 ? (
                    <p className="text-[10px] text-slate-400 font-medium">No hay productos registrados en el catálogo.</p>
                  ) : (
                    <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 bg-slate-50 space-y-1.5">
                      {products.map(prod => {
                        const isChecked = supplierProductIds.includes(prod.id);
                        return (
                          <label key={prod.id} className="flex items-center space-x-2 text-[11px] text-slate-700 font-bold cursor-pointer hover:text-indigo-600">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSupplierProductIds(prev => prev.filter(id => id !== prod.id));
                                } else {
                                  setSupplierProductIds(prev => [...prev, prod.id]);
                                }
                              }}
                              className="rounded border-slate-305 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span>{prod.name} (Stock: {getProductStock(prod, selectedBranchId)})</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                    Selecciona los insumos o productos del catálogo que son provistos por esta distribuidora.
                  </p>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t text-xs font-bold">
                <button 
                  type="button" 
                  onClick={() => setIsSupplierModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg cursor-pointer shadow-md"
                >
                  Guardar Proveedor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: SURTIDO / REABASTECIMIENTO DE PRODUCTOS */}
      {isRestockOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <ArrowLeft className="w-5 h-5 mr-2 text-indigo-600 rotate-180" />
                Registrar un Reabastecimiento
              </h3>
              <button 
                onClick={() => setIsRestockOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-705 bg-slate-105 hover:bg-slate-200 rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRestock} className="space-y-4 text-xs font-semibold">
              <div className="space-y-3">
                {/* Supplier selection filter */}
                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Proveedor Suministrante *</label>
                  <select
                    value={restockForm.supplierId}
                    onChange={e => {
                      // Autopick first product of selected supplier
                      const matched = products.find(p => p.supplierId === e.target.value);
                      setRestockForm({
                        ...restockForm,
                        supplierId: e.target.value,
                        productId: matched ? matched.id : (products[0]?.id || '')
                      });
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 text-slate-700 font-bold"
                  >
                    <option value="">-- Seleccione proveedor --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                    ))}
                  </select>
                </div>

                {/* Product choice selection, filtered or overall */}
                <div className="space-y-1">
                  <label className="text-slate-500 font-bold block">Producto a Surtir *</label>
                  <select
                    value={restockForm.productId}
                    onChange={e => {
                      const matchedProd = products.find(p => p.id === e.target.value);
                      setRestockForm({
                        ...restockForm,
                        productId: e.target.value,
                        // Autofill Cost price recorded on product catalog as suggestion
                        cost: matchedProd ? matchedProd.costPrice.toString() : ''
                      });
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 text-slate-700 font-bold"
                  >
                    <option value="">-- Seleccione el artículo --</option>
                    {(restockForm.supplierId 
                      ? products.filter(p => p.supplierId === restockForm.supplierId)
                      : products
                    ).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock Actual: {p.stock})
                      </option>
                    ))}
                  </select>
                  {restockForm.supplierId && products.filter(p => p.supplierId === restockForm.supplierId).length === 0 && (
                    <p className="text-[10px] text-amber-600 font-bold mt-1">Este proveedor no tiene artículos dedicados. Se muestran todos los productos del catálogo.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-slate-500 font-bold block">Cantidad a Ingresar *</label>
                    <input 
                      type="number"
                      required
                      min="1"
                      placeholder="Ej: 24"
                      value={restockForm.qty}
                      onChange={e => setRestockForm({ ...restockForm, qty: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 text-slate-700 font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-500 font-bold block">Costo Unitario ($) *</label>
                    <input 
                      type="number"
                      step="0.01"
                      required
                      min="0.01"
                      placeholder="Ej: 1.50"
                      value={restockForm.cost}
                      onChange={e => setRestockForm({ ...restockForm, cost: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 text-slate-700 font-bold"
                    />
                  </div>
                </div>

                {/* Live total output layout */}
                {restockForm.qty && restockForm.cost && !isNaN(parseInt(restockForm.qty)) && !isNaN(parseFloat(restockForm.cost)) && (
                  <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-xl space-y-1">
                    <div className="flex justify-between items-center text-xs font-bold text-indigo-900">
                      <span>Total Egreso en Caja:</span>
                      <span className="text-sm font-black text-indigo-650">
                        {formatMXN(parseInt(restockForm.qty) * parseFloat(restockForm.cost))}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-500 leading-tight">El egreso se descontará automáticamente de la caja si hay suficiente saldo o con autorización de saldo negativo.</p>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t text-xs font-bold">
                <button 
                  type="button" 
                  onClick={() => setIsRestockOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer shadow-md"
                >
                  Confirmar Egreso y Surtido
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: EDITAR CATEGORIAS GLOBALES */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <Layers className="w-5 h-5 mr-2 text-indigo-600 animate-pulse" />
                Editar Categorías
              </h3>
              <button 
                type="button"
                onClick={() => setIsCategoryModalOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-705 bg-slate-50 hover:bg-slate-100 rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Form to add a new category */}
              <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2">
                <label className="text-indigo-800 font-extrabold block">Crear Nueva Categoría</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ej: Snacks, Combos, Promos"
                    value={newCategoryInput}
                    onChange={e => setNewCategoryInput(e.target.value)}
                    className="flex-grow bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none font-bold text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddCategory(newCategoryInput)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-lg text-center cursor-pointer transition"
                  >
                    Añadir
                  </button>
                </div>
              </div>

              <p className="text-slate-505 leading-relaxed font-semibold">
                Al renombrar una categoría, todos los artículos de tu catálogo pertenecientes a ella se actualizarán automáticamente.
              </p>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {selectCategoriesList.map(cat => (
                  <div key={cat} className="p-2 bg-slate-50 border border-slate-150 rounded-xl">
                    <CategorySelectorRowItem
                      cat={cat}
                      onRename={(oldName, newName) => {
                        handleRenameCategory(oldName, newName);
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4 border-t text-xs font-bold">
                <button 
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md cursor-pointer transition w-full text-center"
                >
                  Listo / Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUCCESS TRANSACTION RECEIPT & SHARE OPTIONS WINDOW */}
      {lastCompletedSale && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-5 text-slate-800 text-left relative">
            {/* Back / close — always available so the receipt is never a dead-end */}
            <button
              type="button"
              onClick={() => setLastCompletedSale(null)}
              aria-label="Cerrar"
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full transition cursor-pointer z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="text-center space-y-1">
              <span className="inline-block p-3 bg-indigo-50 border border-indigo-100 rounded-full text-indigo-600 animate-bounce"><Check className="w-6 h-6" /></span>
              <h3 className="font-extrabold text-xl text-slate-800">¡Venta Registrada!</h3>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Ticket {lastCompletedSale.id}</p>
              {lastCompletedSale.employeeName && (
                <p className="text-[11px] text-slate-500 font-bold">Atendido por: <span style={{ color: 'var(--brand-primary)' }}>{lastCompletedSale.employeeName}</span></p>
              )}
            </div>

            {/* Micro compact ticket receipt section */}
            <div className="bg-slate-50 border border-slate-150 p-4 rounded-2xl text-xs space-y-2.5 font-mono">
              <div className="flex justify-between font-bold border-b border-dashed pb-2">
                <span>Artículos</span>
                <span>Subtotal</span>
              </div>
              <div className="space-y-1 select-text max-h-24 overflow-y-auto pr-1">
                {lastCompletedSale.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between text-slate-600">
                    <span>{it.quantity}x {it.name}</span>
                    <span>{formatMXN(it.salePrice * it.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed pt-2 space-y-1 text-slate-505">
                <div className="flex justify-between text-[11px]">
                  <span>Subtotal:</span>
                  <span>{formatMXN(lastCompletedSale.subtotal)}</span>
                </div>
                {lastCompletedSale.discount > 0 && (
                  <div className="flex justify-between text-[11px] text-emerald-600">
                    <span>Descuento:</span>
                    <span>-{formatMXN(lastCompletedSale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[11px]">
                  <span>Impuesto:</span>
                  <span>{formatMXN(lastCompletedSale.tax)}</span>
                </div>
                <div className="flex justify-between font-black text-slate-800 border-t pt-1.5 text-sm">
                  <span>Total Neto:</span>
                  <span className="text-indigo-600">{formatMXN(lastCompletedSale.total)}</span>
                </div>
              </div>

              {/* Cash transaction change details helper if cash paid */}
              {lastCompletedSale.paymentMethod === 'Cash' && lastReceivedAmount > lastCompletedSale.total && (
                <div className="bg-amber-50 rounded-xl p-2.5 border border-amber-100/60 mt-2 text-[10px] space-y-0.5">
                  <div className="flex justify-between text-amber-800 font-bold">
                    <span>Efectivo Recibido:</span>
                    <span>{formatMXN(lastReceivedAmount)}</span>
                  </div>
                  <div className="flex justify-between text-amber-900 font-black">
                    <span>Cambio Entregado:</span>
                    <span>{formatMXN(lastReceivedAmount - lastCompletedSale.total)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions share buttons */}
            <div className="space-y-2">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase block tracking-wider text-center">Enviar o Descargar Recibo</span>
              
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <a
                  href={(() => {
                    let text = `*ℹ️ TICKET DE COMPRA - LOGIC POS*\n`;
                    text += `=========================\n`;
                    text += `*ID de Venta:* ${lastCompletedSale.id}\n`;
                    text += `*Fecha/Hora:* ${lastCompletedSale.timestamp}\n`;
                    text += `*Método de Pago:* ${lastCompletedSale.paymentMethod === 'Cash' ? 'Efectivo' : lastCompletedSale.paymentMethod === 'Card' ? 'Tarjeta De/Cr' : lastCompletedSale.paymentMethod === 'Transfer' ? 'Transferencia' : 'Crédito/Fiado'}\n`;
                    if (lastCompletedSale.customerName) {
                      text += `*Cliente:* ${lastCompletedSale.customerName}\n`;
                    }
                    text += `=========================\n`;
                    text += `*Artículos:* \n`;
                    lastCompletedSale.items.forEach(it => {
                      text += `- ${it.quantity}x ${it.name} (${formatMXN(it.salePrice)} c/u) = *${formatMXN(it.salePrice * it.quantity)}*\n`;
                    });
                    text += `=========================\n`;
                    text += `*Subtotal:* ${formatMXN(lastCompletedSale.subtotal)}\n`;
                    if (lastCompletedSale.discount > 0) {
                      text += `*Descuento:* -${formatMXN(lastCompletedSale.discount)}\n`;
                    }
                    text += `*Impuestos:* ${formatMXN(lastCompletedSale.tax)}\n`;
                    text += `*Total Neto:* *${formatMXN(lastCompletedSale.total)}*\n`;
                    text += `=========================\n`;
                    text += `¡Gracias por su compra!\n`;
                    return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
                  })()}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2.5 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-center duration-155"
                >
                  <MessageCircle className="w-3.5 h-3.5" />WhatsApp
                </a>

                <a
                  href={(() => {
                    const subject = `Recibo de Venta Nro ${lastCompletedSale.id} - LOGIC POS`;
                    let body = `Estimado cliente,\n\n`;
                    body += `Le adjuntamos el detalle de su compra realizada el ${lastCompletedSale.timestamp}:\n\n`;
                    body += `Ticket: ${lastCompletedSale.id}\n`;
                    body += `Monto Total: ${formatMXN(lastCompletedSale.total)}\n\n`;
                    body += `Detalle de Artículos:\n`;
                    lastCompletedSale.items.forEach(it => {
                      body += `- ${it.quantity}x ${it.name} - ${formatMXN(it.salePrice * it.quantity)}\n`;
                    });
                    body += `\n¡Gracias por preferir nuestros servicios!\n\nLOGIC POS Cloud`;
                    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                  })()}
                  className="p-2.5 bg-sky-50 hover:bg-sky-100/80 border border-sky-200 text-sky-800 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-center duration-155"
                >
                  <Mail className="w-3.5 h-3.5" />Correo
                </a>
              </div>

              <button
                type="button"
                onClick={() => handlePrintReceipt(lastCompletedSale)}
                className="w-full p-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-250 text-indigo-700 font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <Printer className="w-4 h-4" /> Imprimir Ticket / Guardar PDF
              </button>
            </div>

            <button
              type="button"
              onClick={() => setLastCompletedSale(null)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition shadow hover:shadow-md"
            >
              <ArrowLeft className="w-4 h-4" /> Cerrar
            </button>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: CORTE DE CAJA (CLOSURE) */}
      {isCorteModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <AlertCircle className="w-5 h-5 mr-2 text-amber-600 animate-pulse" />
                Corte de Caja (Cierre)
              </h3>
              <button 
                onClick={() => setIsCorteModalOpen(false)} 
                className="p-1.5 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-full cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs font-semibold text-slate-700">
              <div className="bg-slate-50 border border-slate-150 p-3 rounded-xl space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Saldo Inicial:</span>
                  <span className="font-mono font-bold">{formatMXN(cashRegister.initialCash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Efectivo Sugerido (Sistema):</span>
                  <span className="font-mono text-indigo-750 font-extrabold">{formatMXN(cashRegister.currentCash)}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-600 font-extrabold block">Efectivo Físico Real en Almacén *</label>
                <input 
                  type="number"
                  placeholder="Ej: 1520"
                  step="0.01"
                  value={realCashInput}
                  onChange={e => setRealCashInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-bold text-slate-700"
                />
              </div>

              {realCashInput && !isNaN(parseFloat(realCashInput)) && (
                <div className={`p-3 rounded-xl border text-[11px] leading-tight ${
                  (parseFloat(realCashInput) - cashRegister.currentCash) === 0 
                  ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
                  : (parseFloat(realCashInput) - cashRegister.currentCash) > 0 
                    ? 'bg-blue-50 border-blue-105 text-blue-800' 
                    : 'bg-rose-50 border-rose-100 text-rose-800'
                }`}>
                  <p className="font-bold">Diferencia Contable:</p>
                  <p className="text-xs font-black font-mono mt-0.5">
                    {formatMXN(parseFloat(realCashInput) - cashRegister.currentCash)} 
                    {((parseFloat(realCashInput) - cashRegister.currentCash) === 0) ? ' (Caja cuadra perfectamente)' : ((parseFloat(realCashInput) - cashRegister.currentCash) > 0) ? ' (Sobrante registrado)' : ' (Faltante registrado)'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t text-xs font-bold">
              <button 
                type="button" 
                onClick={() => setIsCorteModalOpen(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={() => {
                  const val = parseFloat(realCashInput);
                  if (isNaN(val) || val < 0) {
                    alert('Por favor ingresa un monto físico válido.');
                    return;
                  }
                  handleCloseCaja(val);
                }}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow cursor-pointer transition"
              >
                Proceder y Cerrar Caja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL WINDOW: APERTURA DE CAJA (OPENING) */}
      {isOpeningCajaModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="font-extrabold text-lg text-slate-800 flex items-center">
                <Store className="w-5 h-5 mr-2 text-indigo-600 animate-pulse" />
                Apertura de Turno y Caja
              </h3>
              <button
                onClick={() => setIsOpeningCajaModalOpen(false)}
                aria-label="Cerrar"
                className="p-1.5 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-full cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 -mt-2">Define el monto inicial en efectivo para iniciar las operaciones del día.</p>

            <div className="space-y-3.5 text-xs font-semibold text-slate-700">
              <div className="space-y-1">
                <label className="text-slate-600 font-extrabold block">Saldo Inicial de Apertura ($ MXN) *</label>
                <input
                  type="number"
                  placeholder="Ej: 500.00"
                  step="0.01"
                  value={openingCashInput}
                  onChange={e => setOpeningCashInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-indigo-505 font-bold text-slate-700"
                />
              </div>
            </div>

            <div className="pt-3 border-t text-xs font-bold w-full flex gap-2">
              <button
                type="button"
                onClick={() => setIsOpeningCajaModalOpen(false)}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl cursor-pointer transition"
              >
                Ahora No
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = parseFloat(openingCashInput);
                  if (isNaN(val) || val < 0) {
                    alert('Por favor de ingresar un monto inicial válido.');
                    return;
                  }
                  handleOpenCaja(val);
                }}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow cursor-pointer transition text-center"
              >
                Abrir Caja Registradora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Company Selector — only for Google-authenticated owners/admins */}
      {user && !isAuthLoading && !activeCompanyId && !isCredentialEmployee && (
        <CompanySelector
          companies={userCompanies}
          userDisplayName={user.displayName}
          userEmail={user.email}
          onCreateCompany={handleCreateCompany}
          onJoinWithCode={handleJoinCompanyWithCode}
          onSelectCompany={(id) => {
            localStorage.setItem(`logic_active_company_${user.uid}`, id);
            setActiveCompanyId(id);
          }}
          onDeleteCompany={handleDeleteCompany}
          onLogout={() => signOut(auth)}
        />
      )}

      {/* Waiting screen for credential employees while Firestore resolves their company */}
      {user && !isAuthLoading && !activeCompanyId && isCredentialEmployee && (
        <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
          {credentialBootstrapFailed ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-rose-900/40 border border-rose-700/30 flex items-center justify-center mb-5">
                <AlertCircle className="w-8 h-8 text-rose-400" />
              </div>
              <h2 className="text-xl font-black text-slate-100 mb-2">No pudimos verificar tu cuenta</h2>
              <p className="text-slate-400 text-sm max-w-xs leading-relaxed mb-6">
                Revisa tu conexión a internet e intenta de nuevo. Si el problema sigue, avisa a tu encargado.
              </p>
              <button
                onClick={() => { setCredentialBootstrapFailed(false); setBootstrapRetryTrigger(n => n + 1); }}
                className="px-6 py-2.5 mb-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow cursor-pointer transition"
              >
                Reintentar
              </button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-indigo-900/40 border border-indigo-700/30 flex items-center justify-center mb-5">
                <ShoppingCart className="w-8 h-8 text-indigo-400 animate-pulse" />
              </div>
              <h2 className="text-xl font-black text-slate-100 mb-2">Conectando al sistema...</h2>
              <p className="text-slate-400 text-sm max-w-xs leading-relaxed mb-6">
                Estamos verificando tus credenciales y cargando tu sucursal asignada.
              </p>
              <div className="flex gap-1.5 mb-8">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </>
          )}
          <button
            onClick={() => signOut(auth)}
            className="text-xs text-slate-500 hover:text-slate-300 underline cursor-pointer transition"
          >
            Salir e intentar de nuevo
          </button>
        </div>
      )}

      {/* GLOBAL MOUNT CHECKPOINT: UNIFIED AUTHENTICATION SELECTION DIALOG (GOOGLE & DIRECT CREDENTIALS) */}
    </div>
  );
}

const CategorySelectorRowItem = ({ cat, onRename }: { cat: string; onRename: (oldName: string, newName: string) => void }) => {
  const [name, setName] = useState(cat);
  const [isEditing, setIsEditing] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
      {isEditing ? (
        <input 
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-grow bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-slate-750 font-bold focus:ring-1 focus:ring-indigo-505 outline-none text-xs"
        />
      ) : (
        <span className="font-bold text-slate-700 px-1">{cat}</span>
      )}
      <div className="flex gap-1 flex-shrink-0 text-[10px] font-bold">
        {isEditing ? (
          <>
            <button
              onClick={() => {
                onRename(cat, name);
                setIsEditing(false);
              }}
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer transition"
            >
              Guardar
            </button>
            <button
              onClick={() => {
                setName(cat);
                setIsEditing(false);
              }}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded cursor-pointer transition"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="px-2 py-1 text-indigo-600 hover:bg-indigo-50 border border-indigo-150 rounded cursor-pointer transition"
          >
            Renombrar
          </button>
        )}
      </div>
    </div>
  );
};
