import fs from 'fs';
import postgres from 'postgres';

// 1. Codebase: modules/catalogo/productos-aliv.ts
const catPath = 'modules/catalogo/productos-aliv.ts';
if (fs.existsSync(catPath)) {
  let cat = fs.readFileSync(catPath, 'utf8');
  cat = cat.replaceAll('cápsulas blandas', 'cápsulas');
  cat = cat.replaceAll('cápsula blanda', 'cápsula');
  cat = cat.replaceAll('capsulas blandas', 'capsulas');
  cat = cat.replaceAll('capsula blanda', 'capsula');
  fs.writeFileSync(catPath, cat, 'utf8');
  console.log(`[OK] Actualizado ${catPath}`);
}

// 2. Codebase: modules/pedidos/servidor.tsx
const pedPath = 'modules/pedidos/servidor.tsx';
if (fs.existsSync(pedPath)) {
  let ped = fs.readFileSync(pedPath, 'utf8');
  ped = ped.replaceAll('cápsulas blandas', 'cápsulas');
  ped = ped.replaceAll('cápsula blanda', 'cápsula');
  ped = ped.replaceAll('capsulas blandas', 'capsulas');
  ped = ped.replaceAll('capsula blanda', 'capsula');
  fs.writeFileSync(pedPath, ped, 'utf8');
  console.log(`[OK] Actualizado ${pedPath}`);
}

// 3. Codebase: src/lib/seed-demo.ts
const seedPath = 'src/lib/seed-demo.ts';
if (fs.existsSync(seedPath)) {
  let seed = fs.readFileSync(seedPath, 'utf8');
  seed = seed.replaceAll('cápsulas blandas', 'cápsulas');
  seed = seed.replaceAll('cápsula blanda', 'cápsula');
  seed = seed.replaceAll('capsulas blandas', 'capsulas');
  seed = seed.replaceAll('capsula blanda', 'capsula');
  fs.writeFileSync(seedPath, seed, 'utf8');
  console.log(`[OK] Actualizado ${seedPath}`);
}

// 4. Base de Datos Neon Cloud
const DATABASE_URL = 'postgresql://neondb_owner:npg_Ku2l9HPgDayj@ep-shy-paper-b4iem0r9-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require';
async function updateDb() {
  const sql = postgres(DATABASE_URL);
  
  // Deals
  const updatedDeals = await sql`
    UPDATE deals
    SET title = REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(title, 'cápsulas blandas', 'cápsulas'),
          'cápsula blanda', 'cápsula'
        ),
        'capsulas blandas', 'capsulas'
      ),
      'capsula blanda', 'capsula'
    )
    WHERE title ILIKE '%blanda%'
    RETURNING id, title
  `;
  console.log(`[DB] Deals actualizados (${updatedDeals.length}):`, updatedDeals);

  // Messages
  const updatedMessages = await sql`
    UPDATE messages
    SET body = REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(body, 'cápsulas blandas', 'cápsulas'),
          'cápsula blanda', 'cápsula'
        ),
        'capsulas blandas', 'capsulas'
      ),
      'capsula blanda', 'capsula'
    )
    WHERE body ILIKE '%blanda%'
    RETURNING id
  `;
  console.log(`[DB] Mensajes actualizados (${updatedMessages.length})`);

  await sql.end();
}

updateDb().catch(console.error);
