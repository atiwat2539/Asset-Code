import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(rootDir, '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

function makePoliciesIdempotent(sql) {
  return sql.replace(
    /DROP POLICY IF EXISTS "([^"]+)" ON ([\w.]+);\s*CREATE POLICY "\1"\s+ON\s+\2|CREATE POLICY "([^"]+)"\s+ON\s+([\w.]+)/g,
    (match, dName, dTable, cName, cTable) => {
      const policyName = dName || cName;
      const tableName = dTable || cTable;
      return `DROP POLICY IF EXISTS "${policyName}" ON ${tableName};\nCREATE POLICY "${policyName}"\n  ON ${tableName}`;
    }
  );
}

async function runQuery(projectId, accessToken, query, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[${label}] HTTP ${res.status}: ${errText}`);
  }
  return res.json();
}

async function main() {
  const env = loadEnvLocal();
  const projectId = env.SUPABASE_PROJECT_ID;
  const accessToken = env.SUPABASE_ACCESS_TOKEN;

  if (!projectId || !accessToken) {
    console.log('⚠️ ไม่พบ SUPABASE_PROJECT_ID หรือ SUPABASE_ACCESS_TOKEN ใน .env.local ข้ามการซิงค์ฐานข้อมูลอัตโนมัติ');
    process.exit(0);
  }

  const sqlFiles = [
    'supabase/migrations/00001_initial_schema.sql',
    'supabase/migrations/00002_rls_policies.sql',
    'supabase/migrations/00003_rpc_functions.sql',
    'supabase/migrations/00004_storage_buckets.sql',
    'supabase/create_admin_user.sql',
  ];

  console.log(`🔄 [Supabase Auto-Sync] กำลังอัปเดตฐานข้อมูลไปยังโปรเจกต์ ${projectId}...`);

  for (const relPath of sqlFiles) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const rawSql = fs.readFileSync(fullPath, 'utf8');
    const safeSql = makePoliciesIdempotent(rawSql);
    await runQuery(projectId, accessToken, safeSql, relPath);
    console.log(`  ✓ อัปเดต ${relPath} สำเร็จ`);
  }

  console.log('✅ [Supabase Auto-Sync] ซิงค์โครงสร้างฐานข้อมูล, RLS, RPC และบัญชี Admin เข้า Supabase เรียบร้อยแล้ว!');
}

main().catch((err) => {
  console.error('❌ [Supabase Auto-Sync] เกิดข้อผิดพลาด:', err.message);
  process.exit(1);
});
