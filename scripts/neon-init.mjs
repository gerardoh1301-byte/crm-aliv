import postgres from "postgres";

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error("Falta DATABASE_URL (no la escribas en el codigo: el repo es publico)");
  process.exit(1);
}
const sql = postgres(connStr);

async function init() {
  await sql.unsafe(`
    insert into team_members (id, email, name, role, active)
    values ('00000000-0000-4000-8000-000000000001', 'admin@alivstore.shop', 'Administrador Aliv', 'admin', true)
    on conflict (id) do nothing;
  `);
  console.log("[ok] Admin insertado en Neon");
  await sql.end();
}

init();
