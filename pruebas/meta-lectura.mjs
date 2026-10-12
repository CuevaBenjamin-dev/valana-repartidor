import { readFileSync } from 'node:fs';
const lineas=readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/);
const env=Object.fromEntries(lineas.filter(x=>x && !x.startsWith('#') && x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));
if(!env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID)throw new Error('Token o Phone Number ID ausente');
const r=await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${env.META_PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name`,{headers:{Authorization:`Bearer ${env.META_ACCESS_TOKEN}`},signal:AbortSignal.timeout(10000)});
if(!r.ok){console.error(`Meta no validó la lectura del número. HTTP ${r.status}.`);process.exitCode=1;}
else {const d=await r.json();if(d.id!==env.META_PHONE_NUMBER_ID)throw new Error('El identificador de Meta no coincide');console.log('Meta validó el token y el Phone Number ID configurados.');}
