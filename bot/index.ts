import postgres from 'npm:postgres@3.4.7';
import { createWorker } from './worker.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {prepare:false,max:1,idle_timeout:20,connect_timeout:8});
const worker = createWorker();
let cached: { TELEGRAM_BOT_TOKEN: string; TELEGRAM_WEBHOOK_SECRET: string } | undefined;
let cachedAt = 0;
async function config() {
 if (cached && Date.now()-cachedAt<60000) return cached;
 const rows = await sql`select name, decrypted_secret from vault.decrypted_secrets where name in ('plus9_telegram_bot_token','plus9_telegram_webhook_secret')`;
 const values = Object.fromEntries(rows.map(row=>[row.name,row.decrypted_secret]));
 if (!values.plus9_telegram_bot_token || !values.plus9_telegram_webhook_secret) throw new Error('Missing configuration');
 cached={ TELEGRAM_BOT_TOKEN:values.plus9_telegram_bot_token, TELEGRAM_WEBHOOK_SECRET:values.plus9_telegram_webhook_secret };
 cachedAt=Date.now();
 return cached;
}
Deno.serve(async request=>{
 try {
  const url=new URL(request.url);
  url.pathname=url.pathname.endsWith('/health') ? '/health' : '/telegram/webhook';
  return await worker.fetch(new Request(url,request),await config());
 } catch { return Response.json({ok:false},{status:503}); }
});
