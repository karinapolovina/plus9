// Parse only the summary table. No personal data or document bytes leave the device.
export function summaryPeriods(items){
 const norm=s=>s.normalize('NFKC').replace(/ĸ/g,'к').replace(/[\s\u200B-\u200D\uFEFF]/g,'');
 const rows=[];
 for(const item of items){if(!norm(item.str))continue;const y=item.transform[5];let row=rows.find(r=>Math.abs(r.y-y)<4);if(!row){row={y,items:[]};rows.push(row);}row.items.push({...item,str:norm(item.str)});}
 rows.sort((a,b)=>b.y-a.y);rows.forEach(r=>r.items.sort((a,b)=>a.transform[4]-b.transform[4]));
 const text=r=>r.items.map(x=>x.str).join('').toUpperCase();
 // PDF text may split a heading into individual letters or wrap it over two lines.
 const header=rows.find(r=>text(r).includes('ДАТЫ')&&text(r).includes('МЕСЯЧНЫЕ'));
 let headerItems=header?.items;
 if(!headerItems){
  const dateRow=rows.find(r=>text(r).includes('ДАТЫ'));
  if(dateRow)headerItems=rows.filter(r=>Math.abs(r.y-dateRow.y)<14).flatMap(r=>r.items).sort((a,b)=>a.transform[4]-b.transform[4]);
 }
 const locate=label=>{
  if(!headerItems)return null;
  const chars=[];for(const item of headerItems){for(let i=0;i<item.str.length;i++)chars.push({c:item.str[i].toUpperCase(),x:item.transform[4]+(item.width||0)*i/item.str.length});}
  const at=chars.map(x=>x.c).join('').indexOf(label);return at<0?null:chars[at].x;
 };
 const dateX=locate('ДАТЫ'),lengthX=locate('ДЛИТЕЛЬНОСТЬ'),periodX=locate('МЕСЯЧНЫЕ');
 if(dateX===null||lengthX===null||periodX===null||!(dateX<lengthX&&lengthX<periodX))throw Error('Не удалось распознать таблицу истории цикла в PDF.');
 const headerY=header?.y||Math.min(...headerItems.map(x=>x.transform[5]));
 const months=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
 let year=0;const result=[];
 for(const row of rows.filter(r=>r.y<headerY-4)){
 const col=(lo,hi)=>row.items.filter(x=>x.transform[4]>=lo-2&&x.transform[4]<hi-2).map(x=>x.str).join('');
 const yearMatch=col(0,dateX).match(/20\d{2}/);if(yearMatch)year=+yearMatch[0];
 const date=col(dateX,lengthX),duration=col(periodX,Infinity).match(/^(\d+)д/);
 if(!duration||!date)continue;
 const start=date.replace(/([а-я])\s+(?=[а-я])/gi,'$1').replace(/^Начало\s*:\s*/,'');
 // For a cross-year range, an explicit year before the dash belongs to its start.
 const beforeDash=start.split(/[—–]/)[0];const ownYear=beforeDash.match(/20\d{2}/);
 const startYear=ownYear?+ownYear[0]:year;
 const day=start.match(/^(\d{1,2})/),month=start.match(/[а-я]+/i);
 const monthIndex=month?months.findIndex(m=>month[0].toLowerCase().startsWith(m)):-1;
 const count=+duration[1];
 if(!day||monthIndex<0||!startYear||count<1||count>31)throw Error('Не удалось уверенно распознать одну из строк таблицы. Даты не добавлены.');
 const d=new Date(Date.UTC(startYear,monthIndex,+day[1]));if(d.getUTCMonth()!==monthIndex)throw Error('Некорректная дата в таблице.');
 result.push({start:d.toISOString().slice(0,10),count});
 }
 if(!result.length)throw Error('В таблице нет распознанных месячных.');return result;
}
export function summarySettings(items){
 const rows=[];
 for(const i of items){let r=rows.find(r=>Math.abs(r.y-i.transform[5])<5);if(!r){r={y:i.transform[5],items:[]};rows.push(r);}r.items.push(i);}
 const lines=rows.map(r=>r.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join('').normalize('NFKC').replace(/ĸ/g,'к').replace(/\s+/g,''));
 const get=label=>{const line=lines.find(l=>l.replace(/\s/g,'').includes(label));const match=line?.match(/(\d+)\s*д/);return match?+match[1]:null;};
 const cycleLength=get('Средняядлительностьцикла'),periodLength=get('Средняядлительностьмесячных');
 if(cycleLength>=15&&cycleLength<=60&&periodLength>=1&&periodLength<=15)return {cycleLength,periodLength,lengthSource:'health-pdf'};
 return null;
}
export async function readHealthPdf(file){
 if(file.size>20*1024*1024)throw Error('Выбери PDF-отчёт о цикле до 20 МБ.');
 const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
 let doc;
 try{doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
 let periods,items,lastError;
 for(let number=1;number<=Math.min(doc.numPages,8);number++){
  const page=await doc.getPage(number);const content=await page.getTextContent();page.cleanup();
  try{periods=summaryPeriods(content.items);items=content.items;break;}catch(error){lastError=error;}
 }
 if(!periods)throw new Error('Не удалось распознать историю цикла в этом PDF. '+(lastError?.message||''));
 const dates=new Set();const today=new Date().toISOString().slice(0,10);
 for(const p of periods)for(let i=0;i<p.count;i++){const d=new Date(p.start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);const iso=d.toISOString().slice(0,10);if(iso<=today)dates.add(iso);}
 const result=[...dates].sort();result.cycleSettings=summarySettings(items);return result;
 }finally{if(doc)await doc.destroy();}
}
