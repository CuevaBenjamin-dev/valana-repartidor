import { readFileSync } from 'node:fs';
const lineas=readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/);
const env=Object.fromEntries(lineas.filter(x=>x && !x.startsWith('#') && x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}));
const endpoint=`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${env.META_WABA_ID}/subscribed_apps`;
const headers={Authorization:`Bearer ${env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'};
const modo=process.argv[2] || 'ver';
if(modo==='configurar'){
  const callback=process.argv[3];
  if(!callback || !/^https:\/\/[a-z0-9.-]+\.trycloudflare\.com\/webhooks\/meta$/.test(callback))throw new Error('Indique la URL HTTPS del webhook del túnel');
  const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({override_callback_uri:callback,verify_token:env.META_VERIFY_TOKEN}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){console.error(`Meta rechazó la configuración del callback. HTTP ${r.status}.`);process.exit(1);}
  console.log('Meta aceptó la actualización del callback.');
}
const r=await fetch(endpoint,{headers,signal:AbortSignal.timeout(10000)});
if(!r.ok){console.error(`No se pudo consultar la suscripción. HTTP ${r.status}.`);process.exit(1);}
const d=await r.json();
for(const x of d.data || [])console.log(JSON.stringify({app_id:x.whatsapp_business_api_data?.id || x.id || null,nombre:x.whatsapp_business_api_data?.name || x.name || null,callback:x.override_callback_uri || null}));
