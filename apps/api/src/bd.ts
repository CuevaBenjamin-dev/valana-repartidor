import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

@Injectable()
export class Bd implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.DATABASE_URL, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  async consulta<T extends QueryResultRow = QueryResultRow>(sql: string, valores: unknown[] = []) {
    return this.pool.query<T>(sql, valores);
  }
  async transaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const resultado = await fn(c); await c.query('COMMIT'); return resultado; }
    catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
