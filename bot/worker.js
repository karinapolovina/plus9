export const APP_URL = 'https://karinapolovina.github.io/plus9/?v=full-audit';
export const WELCOME = "Привет! Это +9 — календарь для тех, кто планирует малыша 🤍\n\nЗдесь можно вести историю цикла, отмечать близость и смотреть примерные фертильные дни.\n\n🌿 «Мой цикл» — месячные, сердечки для секса без защиты и прогноз следующих циклов.\n✨ «Если сегодня» — ориентировочная дата рождения малыша для выбранной даты зачатия.\n⭐ «Хочу знак» — дополнительный способ посмотреть даты: выбрать знак и сравнить его период со своим циклом.\n\nЧтобы добавить отметку, открой календарь, нажми на дату, выбери нужное и сохрани.\n\nНачать можно с «Моего календаря». В инструкции ниже — все шаги, включая импорт истории и удаление отметок.\n\nРасчёты приблизительные: цикл и срок родов могут меняться.";
export const HELP = "Как пользоваться +9 🤍\n\n🦁 «Если сегодня»\nВыбери дату зачатия — увидишь примерную дату рождения и возможный знак. В блоке «Если раньше или позже» — соседние знаки.\n\n⭐ «Хочу знак»\nЕсли хочется посмотреть возможный знак малыша, выбери знак и год начала его периода. «Совпадает ли с моим циклом?» покажет пересечение с примерными фертильными днями. Если данных нет, приложение предложит их добавить.\n\n♥ «Мой цикл»\nНажми дату. Отметь «Секс без защиты» и/или «Месячные», затем «Сохранить». Сердечко означает секс, красный контур — отмеченные месячные. Пунктир — прогноз месячных, подчёркнутая дата — примерная овуляция.\n\n✏️ Убрать отметку\nСнова открой дату, сними нужную галочку и сохрани. Крестик закрывает карточку без сохранения.\n\n📥 Перенести историю\nВ «Моём цикле» раскрой импорт из «Здоровья» или Flo. Выбери файл, проверь найденные даты и нажми «Добавить даты». Для «Здоровья» удобнее небольшой PDF-отчёт о цикле; также поддерживается export.xml.\n\nИстория помогает вести наблюдения за циклом. Отметки хранятся в этом браузере или на этом устройстве в Telegram. Во внешнем браузере будет отдельный календарь. Прогноз приблизительный и не подходит для контрацепции.";
const keyboard = { inline_keyboard: [
 [{ text: '✨ Открыть +9', web_app: { url: APP_URL } }],
 [{ text: '⭐ Выбрать знак', web_app: { url: APP_URL+'&view=plan' } },{ text: '♥ Мой календарь', web_app: { url: APP_URL+'&view=cycle' } }],
 [{ text: '📖 Как пользоваться', callback_data: 'help' }]
] };
// Best-effort retry suppression within a Worker isolate; no chat or cycle data stored.
const processed = new Map();
async function telegram(env, method, body, transport) {
  const response = await transport('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram request failed');
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export function createWorker(transport = fetch, html = '<!doctype html><html lang="ru"><meta charset="utf-8"><title>+9</title><a href="https://karinapolovina.github.io/plus9/">Открыть +9</a></html>') {
 return { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== '/telegram/webhook') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', {status:405});
    if (path === '/health') return json({ ok: true, service: 'plus9-telegram', configured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) });
    if (path !== '/' && path !== '/index.html') return new Response('Not found', {status:404});
    return new Response(request.method === 'HEAD' ? null : html, {headers:{'content-type':'text/html; charset=utf-8'}});
  }
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ok:false},503);
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) return json({ok:false},403);
  if (Number(request.headers.get('content-length')) > 65536) return json({ok:false},413);
  let update;
  try { const body=await request.text(); if(body.length>65536)return json({ok:false},413); update=JSON.parse(body); }
  catch { return json({ok:false},400); }
  if (!Number.isSafeInteger(update?.update_id)) return json({ok:false},400);
  const now=Date.now();
  for(const [id, timestamp] of processed) if(now-timestamp>300000) processed.delete(id);
  if(processed.has(update.update_id)) return json({ok:true});
  try {
    const callback=update.callback_query;
    if(callback) {
      if(callback.data !== 'help' || callback.message?.chat?.type !== 'private') return json({ok:true});
      if(!Number.isSafeInteger(callback.message.chat.id) || typeof callback.id !== 'string') return json({ok:false},400);
      await telegram(env,'answerCallbackQuery',{callback_query_id:callback.id},transport);
      await telegram(env,'sendMessage',{chat_id:callback.message.chat.id,text:HELP,reply_markup:keyboard},transport);
    } else {
      const message=update.message;
      if(message?.chat?.type !== 'private' || typeof message.text !== 'string') return json({ok:true});
      if(!Number.isSafeInteger(message.chat.id)) return json({ok:false},400);
      const command=message.text.trim().split(/\s/)[0].toLowerCase();
      if(command.includes('@') && !command.endsWith('@plusninecyclebot')) return json({ok:true});
      const base=command.split('@')[0];
      const text=base==='/start' ? WELCOME : base==='/help' ? HELP : 'Все расчёты — в мини-приложении +9. Нажми кнопку ниже или /help, чтобы узнать больше.';
      await telegram(env,'sendMessage',{chat_id:message.chat.id,text,reply_markup:keyboard},transport);
    }
    if(processed.size>=2000) processed.delete(processed.keys().next().value);
    processed.set(update.update_id,now);
    return json({ok:true});
  } catch { return json({ok:false},502); }
 }};
}
export default createWorker();
