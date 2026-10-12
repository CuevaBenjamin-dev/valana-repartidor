import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const raiz=existsSync(resolve(process.cwd(),'database/migraciones'))?process.cwd():resolve(process.cwd(),'../..');
  const ruta = resolve(raiz, 'database/migraciones');
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS migraciones_aplicadas (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())');
    for (const archivo of readdirSync(ruta).filter(x => x.endsWith('.sql')).sort()) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const previo = await c.query('SELECT 1 FROM migraciones_aplicadas WHERE nombre=$1', [archivo]);
        if (!previo.rowCount) {
          await c.query(readFileSync(resolve(ruta, archivo), 'utf8'));
          await c.query('INSERT INTO migraciones_aplicadas(nombre) VALUES($1)', [archivo]);
          process.stdout.write(`Migración aplicada: ${archivo}\n`);
        }
        await c.query('COMMIT');
      } catch (error) { await c.query('ROLLBACK'); throw error; }
      finally { c.release(); }
    }
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
