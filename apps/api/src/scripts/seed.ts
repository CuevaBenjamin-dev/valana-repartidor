import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const credenciales: string[] = [];
  try {
    await c.query('BEGIN');
    const negocio = (await c.query<{id:string}>(`INSERT INTO negocios(nombre,meta_phone_number_id) VALUES($1,$2)
      ON CONFLICT(meta_phone_number_id) DO UPDATE SET meta_phone_number_id=EXCLUDED.meta_phone_number_id RETURNING id`,
      ['Boston Bilingual School',process.env.META_PHONE_NUMBER_ID || '1461460113708939'])).rows[0];
    const equipo = (await c.query<{id:string}>(`INSERT INTO equipos(negocio_id,nombre) VALUES($1,'Equipo comercial')
      ON CONFLICT(negocio_id,nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id`,[negocio.id])).rows[0];
    for (const [numero,identificador,nombre] of [[1,'admisiones','Admisiones'],[2,'horarios','Horarios'],[3,'matriculas','Matrículas'],[4,'otras_consultas','Otras consultas']] as const) {
      await c.query(`INSERT INTO opciones_menu(negocio_id,equipo_id,numero,identificador,nombre) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(equipo_id,numero) DO NOTHING`,[negocio.id,equipo.id,numero,identificador,nombre]);
    }
    const usuarios = [
      ['Ana','ana@valana.local','asesor'],['Bruno','bruno@valana.local','asesor'],
      ['Carlos','carlos@valana.local','asesor'],['Lucía','lucia@valana.local','asesor'],
      ['Supervisor','supervisor@valana.local','supervisor'],['Administrador','admin@valana.local','administrador']
    ];
    for (const [nombre,correo,rol] of usuarios) {
      const existe = await c.query('SELECT id FROM usuarios WHERE negocio_id=$1 AND correo=$2',[negocio.id,correo]);
      let id: string;
      if (!existe.rowCount) {
        const clave = randomBytes(18).toString('base64url');
        const hash = await argon2.hash(clave, { type: argon2.argon2id });
        id = (await c.query<{id:string}>(`INSERT INTO usuarios(negocio_id,nombre,correo,clave_hash,rol)
          VALUES($1,$2,$3,$4,$5) RETURNING id`,[negocio.id,nombre,correo,hash,rol])).rows[0].id;
        credenciales.push(`${correo}: ${clave}`);
      } else id = existe.rows[0].id;
      await c.query(`INSERT INTO miembros_equipo(equipo_id,usuario_id) VALUES($1,$2)
        ON CONFLICT(equipo_id,usuario_id) DO NOTHING`,[equipo.id,id]);
    }
    await c.query('COMMIT');
    if (credenciales.length) {
      const raiz=existsSync(resolve(process.cwd(),'database'))?process.cwd():resolve(process.cwd(),'../..');
      const ruta = resolve(raiz, '.local/credenciales-iniciales.txt');
      mkdirSync(resolve(raiz, '.local'), { recursive: true });
      if (existsSync(ruta)) throw new Error('Ya existe archivo privado de credenciales; no se sobrescribe');
      writeFileSync(ruta, `Credenciales iniciales de Valana. Conservar en privado.\n${credenciales.join('\n')}\n`,{mode:0o600});
      process.stdout.write('Usuarios iniciales creados. Credenciales guardadas en .local/credenciales-iniciales.txt\n');
    }
  } catch (error) { await c.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { c.release(); await pool.end(); }
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
