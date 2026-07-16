// Repairs legacy `branchStocks` gaps caused by the per-sucursal stock bug: any
// producto/sucursal pair missing an explicit branchStocks entry used to fall back to
// the shared flat `stock` field, which applyStockDeltas decrements on EVERY sale from
// EVERY sucursal — so an untouched sucursal could see its "stock" drop from sales that
// never happened there. See App.tsx handleSaveProduct / handleSaveBranch for the
// going-forward fix (every branch always gets an explicit entry from creation).
//
// This script only fills in the gaps for products/branches that already existed before
// that fix. For a product with NO branchStocks entries at all (pre-dates the field
// entirely), its current flat `stock` is assumed to belong to the matriz branch (or the
// first branch if none is flagged isMatriz) and is preserved there; every other branch
// gets 0. For a product that already has SOME entries, any branch still missing one just
// gets 0 (consistent with "new branch starts empty until surtido").
//
// Authenticates as an existing owner/admin/master_admin credential account and writes
// through the same client SDK + firestore.rules any real user would hit — no service
// account, no rules bypass.
//
// Dry-run by default: prints the plan without writing anything. Pass APPLY=true to write.
//
// Uso:
//   SEED_COMPANY_ID=comp_XXXXXX SEED_ADMIN_NUMBER=101001 node scripts/fix-branch-stocks.mjs
//   SEED_COMPANY_ID=comp_XXXXXX SEED_ADMIN_NUMBER=101001 APPLY=true node scripts/fix-branch-stocks.mjs

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocs, collection, updateDoc } from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'firebase-applet-config.json'), 'utf-8')
);

const companyId = process.env.SEED_COMPANY_ID;
const adminNumber = process.env.SEED_ADMIN_NUMBER;
const apply = process.env.APPLY === 'true';

if (!companyId || !adminNumber) {
  console.error('Uso: SEED_COMPANY_ID=comp_XXXXXX SEED_ADMIN_NUMBER=101001 node scripts/fix-branch-stocks.mjs');
  process.exit(1);
}

async function main() {
  const app = initializeApp(firebaseConfig, 'fix-branch-stocks-' + Date.now());
  const auth = getAuth(app);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  const adminEmail = `${companyId}_${adminNumber}@logicpos.com`;
  console.log(`Iniciando sesión como ${adminEmail}...`);
  await signInWithEmailAndPassword(auth, adminEmail, adminNumber);

  const branchesSnap = await getDocs(collection(db, 'companies', companyId, 'branches'));
  const branches = branchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (branches.length === 0) {
    throw new Error('Esta empresa no tiene sucursales registradas.');
  }
  const homeBranchId = (branches.find(b => b.isMatriz) || branches[0]).id;
  console.log(`Sucursales (${branches.length}): ${branches.map(b => b.name).join(', ')}`);
  console.log(`Sucursal "hogar" para stock heredado (sin branchStocks previo): ${branches.find(b => b.id === homeBranchId).name}`);
  console.log(`Modo: ${apply ? 'APLICANDO CAMBIOS' : 'DRY-RUN (nada se escribe, agrega APPLY=true para aplicar)'}\n`);

  const productsSnap = await getDocs(collection(db, 'companies', companyId, 'products'));
  let changedCount = 0;

  for (const prodDoc of productsSnap.docs) {
    const prod = { id: prodDoc.id, ...prodDoc.data() };
    const existing = prod.branchStocks || {};
    const hadAnyEntry = Object.keys(existing).length > 0;
    const updatedStocks = { ...existing };
    let changed = false;

    for (const branch of branches) {
      if (updatedStocks[branch.id] === undefined) {
        if (!hadAnyEntry && branch.id === homeBranchId) {
          updatedStocks[branch.id] = prod.stock || 0;
        } else {
          updatedStocks[branch.id] = 0;
        }
        changed = true;
      }
    }

    if (!changed) continue;
    changedCount++;
    console.log(`- ${prod.name} (${prod.id}): ${JSON.stringify(existing)} -> ${JSON.stringify(updatedStocks)}`);

    if (apply) {
      await updateDoc(doc(db, 'companies', companyId, 'products', prod.id), { branchStocks: updatedStocks });
    }
  }

  console.log(`\n${changedCount} de ${productsSnap.size} productos ${apply ? 'reparados' : 'requieren reparación'}.`);
  if (!apply && changedCount > 0) {
    console.log('Vuelve a correr con APPLY=true para escribir estos cambios.');
  }

  await signOut(auth);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
