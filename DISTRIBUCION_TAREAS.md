# LOGIC POS — Distribución de Tareas: Segundo Entregable (Restaurante)

> Este documento reparte el trabajo del plan técnico completo (`docs/PLAN_RESTAURANTE.md`, 6 fases)
> entre el equipo asignado a este entregable. Para el detalle técnico de cada fase (archivos, líneas,
> colecciones de datos, reglas de Firestore), consultar siempre `PLAN_RESTAURANTE.md` — este documento
> solo asigna responsables, calendario, fechas límite y contexto operativo.

**Ventana de entrega:** 2026-07-06 → 2026-07-16 (semana y media).

**Disponibilidad de Andrea:** **martes, jueves y viernes** de cada semana del proyecto (3 días fijos,
sin fines de semana) — no disponible lunes ni miércoles. Sus tareas se mantienen **cortas y acotadas
por día** (una pieza de UI/copy concreta, no un componente completo de punta a punta), para que su
carga diaria sea ligera. Cualquier integración final o continuación pesada la cierran Joseph/Yael.

---

## Equipo y criterio de asignación

| Persona | Área de responsabilidad |
|---|---|
| **Joseph Dircio** | Infraestructura (repo, proyecto Firebase nuevo), modelo de datos y `firestore.rules`, lógica transaccional (deltas de stock/caja), impresión nativa Android, build y despliegue. |
| **Yael Avila** | Mismo nivel de responsabilidad que Joseph: front + back con manipulación directa de base de datos — componentes del flujo gastronómico, roles y permisos, lógica de comandas/cierre de cuenta. |
| **Andrea Jimenez** | UI y presentación sin escritura/lectura directa a Firestore, textos y estilos, documentación y pruebas manuales guiadas. Disponible solo martes/jueves/viernes, con tareas cortas de un día cada una. Su alcance en tareas de base de datos crecerá conforme tome práctica con el proyecto. |

Las tareas que implican modelar datos, escribir/editar `firestore.rules`, o cualquier lógica que lea o
escriba directamente en Firestore quedan con Joseph y Yael. Las tareas de Andrea son siempre piezas
cortas sobre datos ya resueltos (props, componentes visuales, configuración de texto) o verificación
funcional del trabajo ya construido — ninguna tarea suya se extiende más de un día.

---

## Días de Andrea en la ventana del proyecto

| Semana | Días disponibles |
|---|---|
| Semana 1 (07-06 a 07-10) | **Martes 07-07, jueves 07-09, viernes 07-10** |
| Semana 2 (07-13 a 07-16) | **Martes 07-14, jueves 07-16** (viernes 07-17 queda fuera de la ventana de entrega) |

---

## Distribución por fase y fechas límite

| Fase | Tareas | Responsable(s) | Fecha límite |
|---|---|---|---|
| **Fase 0** — Repo e infraestructura nueva | Copiar working tree, `git init`, repo privado nuevo, proyecto Firebase nuevo, Auth providers, registrar apps Web/Android | Joseph | **07-06 (lun)** — bloquea todo lo demás. |
| **Fase 1a** — Modelo de datos (TypeScript) | Campos nuevos en interfaces (`Company.businessType`, `Member.role: 'mesero'`, `Product.printDestination`, IPs de impresora en `PrintConfig`, opcionales en `Sale`) e interfaces nuevas `Table`/`Order`/`OrderItem` en `src/App.tsx` + tipados espejo en `CompanySettingsView.tsx`. **Joseph inicia.** | Joseph | **07-07 (mar)** — bloquea Fase 1b. |
| **Fase 1b** — `firestore.rules` + verificación | Extender `isValidCompanyMember`/`isValidRoleGrant` (`mesero`), `businessType` en `isValidCompany`, opcionales en `isValidSale`, nuevos `isValidTable`/`isValidOrder` + reglas de `tables`/`orders`, desplegar y verificar con emulador (mesero vs admin). **Yael finaliza.** | Yael | **07-07 (mar)** — bloquea Fases 2 y 4. |
| **Fase 2a** — Rol mesero + UI restringida | Lógica de permisos, `WaiterShell.tsx` (shell restringido para mesero, recibe `products`/`branches`/`tables`/`orders` ya suscritos vía props), opción `mesero` en badge/`<select>`/`handleChangeMemberRole` de `CompanySettingsView.tsx` | Yael | **07-10 (vie)** |
| **Fase 2b** — Panel de auditoría | `AuditView.tsx`: cruza `sales` + `orders` + log de `cashRegisters`, filtrable por mesero/mesa/sucursal/fecha (sin duplicar lógica de seguridad — las reglas de Fase 1b ya permiten esas lecturas a ese nivel de rol) | Joseph | **07-10 (vie)** |
| | Tarea corta: textos de badges y opción `mesero` en el `<select>` de rol de `CompanySettingsView.tsx` (solo copy, un día) | Andrea — **mar 07-07** | 07-07 (mar) |
| **Fase 3** — Autenticación ágil | Tarea corta: maquetado visual del pad numérico de `EmployeePinLogin.tsx` (estructura y estilos, sin lógica) | Andrea — **jue 07-09** | 07-09 (jue) |
| | Tarea corta: pulido visual de `EmployeePinLogin.tsx` (tamaños táctiles, estados) | Andrea — **vie 07-10** | 07-10 (vie) |
| | Integración del pad con `handleCredentialSignIn` (lógica de auth ya existente) | Yael | **07-10 (vie)** |
| **Fase 4a** — Helper transaccional | Extraer `buildAndCommitSale(items, paymentMethod, ..., extra?: {orderId, tableId, waiterName})` del cuerpo de `completeTransaction()`, mismo patrón atómico de `applyStockDeltas`/`applyCashDelta`, reutilizable por el carrito POS y por el cierre de mesa. **Joseph inicia.** | Joseph | **07-13 (lun, semana 2)** — bloquea Fase 4b. |
| **Fase 4b** — Mesas y comanda | `TablesFloorView.tsx` (grid de mesas, estados libre/ocupada/por_cobrar, conectado al maquetado de Andrea) y `ComandaView.tsx` (ítems por ronda, "Enviar a Cocina/Barra", cierre de cuenta vía `buildAndCommitSale`); cuentas abiertas/cerradas filtrando `orders` por `status`. **Yael finaliza.** | Yael | **07-14 (mar, semana 2)** — bloquea Fase 5b. |
| | Tarea corta: maquetado visual de `TablesFloorView.tsx` (grid de mesas) sobre datos mock/props ya resueltas | Andrea — **mar 07-14** | 07-14 (mar) |
| **Fase 5a** — Plugin nativo + encoding ESC/POS | `EscPosPrinterPlugin` (Capacitor, Java, `printRaw` vía `Socket` TCP) y `src/utils/escpos.ts` (construcción de la secuencia ESC/POS, codificación base64). **Joseph inicia.** | Joseph | **07-15 (mié, semana 2)** — bloquea Fase 5b. |
| **Fase 5b** — Disparo desde la UI | En `ComandaView.tsx`: agrupar ítems de la ronda por `printDestination` y llamar al plugin; settings UI en `CompanySettingsView.tsx` (IP/puerto de Cocina y Barra + botón "Probar Impresora"). **Yael finaliza.** | Yael | **07-15 (mié, semana 2)** |
| **Fase 6** — Build y despliegue | `appId` nuevo, firma de release, dominio, VPS, Nginx, Certbot, Authorized domains | Joseph | **07-15 (mié, semana 2)** |
| **Transversal** | Tarea corta: capturas finales + checklist de "Verificación end-to-end" de `PLAN_RESTAURANTE.md` | Andrea — **jue 07-16** | 07-16 (jue) |
| | QA final conjunta de todas las fases | Todo el equipo | **07-16 (jue)** — día de entrega. |

---

## Calendario (2026-07-06 → 2026-07-16)

**Semana 1**
- **Lun 07-06 (Andrea fuera):** Joseph — Fase 0 (repo/Firebase nuevo).
- **Mar 07-07:** Fase 1 dividida en dos: **Joseph inicia con Fase 1a** (modelo de datos en
  TypeScript) y **Yael finaliza con Fase 1b** (`firestore.rules` + verificación con emulador).
  Andrea (tarea corta): copy de badges/`<select>` de Fase 2.
- **Mié 07-08 (Andrea fuera):** Yael arranca Fase 2a (`WaiterShell.tsx`, rol mesero en UI). Joseph
  arranca Fase 2b (`AuditView.tsx`) — en paralelo, ninguna depende de la otra.
- **Jue 07-09:** Yael y Joseph continúan Fase 2a/2b respectivamente. Andrea (tarea corta): maquetado
  visual de `EmployeePinLogin.tsx`.
- **Vie 07-10:** Yael cierra Fase 2a e integra el pad numérico con `handleCredentialSignIn` (Fase 3).
  Joseph cierra Fase 2b y arranca Fase 4a (`buildAndCommitSale`). Andrea (tarea corta): pulido visual
  de `EmployeePinLogin.tsx`.

**Semana 2**
- **Lun 07-13 (Andrea fuera):** Joseph cierra Fase 4a (`buildAndCommitSale` extraído y reutilizable).
  Yael arranca Fase 4b (`ComandaView.tsx`; `TablesFloorView.tsx` queda a la espera del maquetado de
  Andrea, que llega mañana).
- **Mar 07-14:** Andrea (tarea corta): maquetado visual de `TablesFloorView.tsx`. Yael lo conecta a
  datos reales y cierra Fase 4b. Joseph arranca Fase 5a (plugin nativo `EscPosPrinterPlugin` +
  `escpos.ts`).
- **Mié 07-15 (Andrea fuera):** Joseph cierra Fase 5a y Fase 6 (build/deploy). Yael cierra Fase 5b
  (disparo de impresión desde `ComandaView.tsx` + settings UI de IPs).
- **Jue 07-16 (entrega):** Andrea (tarea corta): capturas finales + checklist de QA manual. Todo el
  equipo hace la QA final conjunta, consolida evidencia y entrega el proyecto.

---

## Stack del proyecto

- **React 19 + TypeScript + Vite** — base de toda la aplicación (`src/App.tsx` y componentes nuevos en
  `src/components/`).
- **Firebase Auth + Firestore** — autenticación (incluye el login de 2 campos de empleados) y toda la
  base de datos (`companies/{companyId}/...`).
- **TailwindCSS 4** — estilos, con variables CSS de marca (`--brand-dark`, `--brand-primary`,
  `--brand-accent`) inyectadas dinámicamente.
- **Lucide React** — iconografía SVG.
- **Recharts** — gráficas del panel de Estadísticas.
- **Capacitor 8.4.1** — empaquetado Android; el plugin nativo de impresión ESC/POS de la Fase 5 se
  agrega aquí.
- **jsPDF / jspdf-autotable** — generación del Corte Mensual en PDF.
- **Node 20 + Express + PM2 + Nginx** (VPS IONOS) — despliegue del sitio web (Fase 6).
- **GitHub (`gh` CLI) y Firebase CLI** — control de versiones y despliegue de `firestore.rules`/hosting.

---

## Herramientas de apoyo disponibles

Yael y Andrea cuentan con las siguientes herramientas orientadas a Gemini/Google para acelerar su parte
del trabajo:

- **Antigravity CLI**
- **Antigravity IDE**
- **Gemini 3.1 Pro**
- **Gemini 3.5 Flash High**

Cada quien puede apoyarse en estas herramientas según lo necesite para su parte asignada.

---

## Documentación y evidencia

- Cada persona toma **capturas de pantalla** de su avance conforme completa cada tarea (no solo al
  final de la fase).
- Se lleva una **bitácora corta** por tarea/fase: qué se hizo, qué quedó pendiente, y cualquier
  decisión o bloqueo encontrado — mismo espíritu que el checklist de
  `docs/PROGRESO_DEV_RESTAURANTES.md`, pero reportado individualmente por cada quien.
- Toda la evidencia (capturas + bitácora) se sube a la plataforma de gestión de proyectos
  **`sync.einnovacionmx.com`**, al cierre de cada día de trabajo.
- Si alguna fecha límite de la tabla no se alcanza, se reporta ese mismo día en la plataforma para
  ajustar el resto del calendario sin comprometer la entrega del 07-16.
