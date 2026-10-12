import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, Controller, Post, Get, Body, Req, Res, UseGuards, HttpCode, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { Bd } from './bd';
import { config } from './config';

export interface UsuarioSesion { id:string; negocio_id:string; nombre:string; correo:string; rol:'asesor'|'supervisor'|'administrador'; activo:boolean; }
export interface SolicitudAutenticada extends Request { usuario:UsuarioSesion; sesion_expira_en:Date; }
const hash = (s:string) => createHash('sha256').update(s).digest('hex');
const seguro = (a:string,b:string) => { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
const intentos = new Map<string,{n:number;hasta:number}>();
const duracionSesion=365*24*60*60_000;
const renovarAntesDe=330*24*60*60_000;
const opcionesCookie={sameSite:'lax' as const,secure:config.NODE_ENV==='production',path:'/'};

@Injectable()
export class SesionesGuard implements CanActivate {
  constructor(private readonly bd:Bd) {}
  async canActivate(context:ExecutionContext):Promise<boolean> {
    const req=context.switchToHttp().getRequest<SolicitudAutenticada>();
    const token = req.cookies?.['valana_sesion'];
    if (typeof token !== 'string') throw new UnauthorizedException();
    const encontrado=await this.bd.consulta<UsuarioSesion & {csrf_hash:string;expira_en:Date}>(`SELECT u.id,u.negocio_id,u.nombre,u.correo,u.rol,u.activo,s.csrf_hash,s.expira_en
      FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id
      WHERE s.token_hash=$1 AND s.revocada_en IS NULL AND s.expira_en>now()`,[hash(token)]);
    if (!encontrado.rowCount || !encontrado.rows[0].activo) throw new UnauthorizedException();
    const {csrf_hash,expira_en,...usuario}=encontrado.rows[0]; req.usuario=usuario; req.sesion_expira_en=expira_en;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const cabecera=req.header('x-csrf-token');
      const cookie=req.cookies?.['valana_csrf'];
      if (typeof cabecera!=='string' || typeof cookie!=='string' || !seguro(cabecera,cookie) || !seguro(hash(cabecera),csrf_hash)) throw new ForbiddenException('CSRF inválido');
    }
    if (expira_en.getTime()-Date.now()<renovarAntesDe) {
      const csrf=req.cookies?.['valana_csrf'];
      if(typeof csrf==='string' && seguro(hash(csrf),csrf_hash)) {
        const renovada=await this.bd.consulta<{expira_en:Date}>(`UPDATE sesiones SET expira_en=now()+interval '365 days'
          WHERE token_hash=$1 AND revocada_en IS NULL AND expira_en>now() RETURNING expira_en`,[hash(token)]);
        if(renovada.rowCount){
          req.sesion_expira_en=renovada.rows[0].expira_en;
          const res=context.switchToHttp().getResponse<Response>();
          res.cookie('valana_sesion',token,{...opcionesCookie,httpOnly:true,maxAge:duracionSesion});
          res.cookie('valana_csrf',csrf,{...opcionesCookie,httpOnly:false,domain:config.COOKIE_DOMAIN || undefined,maxAge:duracionSesion});
        }
      }
    }
    return true;
  }
}

@Controller('sesion')
export class SesionController {
  constructor(private readonly bd:Bd) {}
  @Post('iniciar') @HttpCode(200)
  async iniciar(@Body() datos:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response) {
    const cuerpo = datos && typeof datos==='object' ? datos as Record<string,unknown> : {};
    const correo=typeof cuerpo.correo==='string' ? cuerpo.correo.trim().toLowerCase() : '';
    const clave=typeof cuerpo.clave==='string' ? cuerpo.clave : '';
    if (!correo || !clave || clave.length>256) throw new UnauthorizedException('Credenciales inválidas');
    const llave=`${req.ip}:${correo}`;
    const ahora=Date.now(), previo=intentos.get(llave);
    if (previo && previo.hasta>ahora && previo.n>=5) throw new HttpException('Demasiados intentos',429);
    const r=await this.bd.consulta<UsuarioSesion & {clave_hash:string}>('SELECT id,negocio_id,nombre,correo,rol,activo,clave_hash FROM usuarios WHERE correo=$1',[correo]);
    const valido=r.rowCount && r.rows[0].activo && await argon2.verify(r.rows[0].clave_hash,clave);
    if (!valido) { intentos.set(llave,{n:(previo?.hasta && previo.hasta>ahora ? previo.n : 0)+1,hasta:ahora+15*60_000}); throw new UnauthorizedException('Credenciales inválidas'); }
    intentos.delete(llave);
    const token=randomBytes(32).toString('base64url'), csrf=randomBytes(32).toString('base64url');
    await this.bd.consulta(`INSERT INTO sesiones(usuario_id,token_hash,csrf_hash,expira_en) VALUES($1,$2,$3,now()+interval '365 days')`,[r.rows[0].id,hash(token),hash(csrf)]);
    res.cookie('valana_sesion',token,{...opcionesCookie,httpOnly:true,maxAge:duracionSesion});
    res.cookie('valana_csrf',csrf,{...opcionesCookie,httpOnly:false,domain:config.COOKIE_DOMAIN || undefined,maxAge:duracionSesion});
    const {clave_hash,...usuario}=r.rows[0]; void clave_hash;
    return {usuario};
  }
  @Get('actual') @UseGuards(SesionesGuard)
  actual(@Req() req:SolicitudAutenticada) { return {usuario:req.usuario}; }
  @Post('cerrar') @UseGuards(SesionesGuard) @HttpCode(200)
  async cerrar(@Req() req:SolicitudAutenticada,@Res({passthrough:true}) res:Response) {
    await this.bd.consulta('UPDATE sesiones SET revocada_en=now() WHERE token_hash=$1',[hash(req.cookies['valana_sesion'])]);
    res.clearCookie('valana_sesion',{path:'/'}); res.clearCookie('valana_csrf',{path:'/',domain:config.COOKIE_DOMAIN || undefined});
    return {ok:true};
  }
}

export function exigirRol(usuario:UsuarioSesion, roles:UsuarioSesion['rol'][]) {
  if (!roles.includes(usuario.rol)) throw new ForbiddenException('Acceso denegado');
}
