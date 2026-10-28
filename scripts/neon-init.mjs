import postgres from "postgres";

const connStr = "postgresql://neondb_owner:npg_Ku2l9HPgDayj@ep-shy-paper-b4iem0r9-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require";
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
