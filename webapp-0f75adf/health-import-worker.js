// A dedicated worker reads only 64 KiB at a time. No XML DOM, network requests or full-file strings.
function attr(tag,name){const m=tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\\x27])([\\s\\S]*?)\\1'));return m?.[2];}
const dayMs=86400000;
function calendarDay(value){const key=value?.match(/^(\d{4}-\d{2}-\d{2})[ T]/)?.[1];if(!key)return null;const date=new Date(key+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===key?date:null;}
function collect(tag,dates,today){
 if(attr(tag,'type')!=='HKCategoryTypeIdentifierMenstrualFlow')return;
 if(!/^(?:HKCategoryValueMenstrualFlow(?:Unspecified|Light|Medium|Heavy)|[1-4])$/.test(attr(tag,'value')||''))return;
 const first=calendarDay(attr(tag,'startDate')),endText=attr(tag,'endDate'),last=calendarDay(endText);
 if(!first||!last||first>last)return;
 const midnight=/[ T]00:00:00(?:[.,]0+)?(?:\s|Z|[+-]|$)/.test(endText);
 const finalDay=midnight&&last>first?new Date(+last-dayMs):last;
 // A menstrual flow record spanning a year is malformed, not a request to allocate an unbounded date list.
 if(finalDay-first>366*dayMs)return;
 for(let day=+first;day<=+finalDay&&day<=today;day+=dayMs)dates.add(new Date(day).toISOString().slice(0,10));
}
self.onmessage=async({data})=>{
 try {
  const {file,today}=data;
  if(!file?.size)throw Error('Файл пустой. Выбери export.xml.');
  const decoder=new TextDecoder(),dates=new Set();let buffer='',root=false,closed=false,lastProgress=-1;
  const chunkSize=65536;
  for(let offset=0;offset<file.size;offset+=chunkSize){
   buffer+=decoder.decode(await file.slice(offset,offset+chunkSize).arrayBuffer(),{stream:offset+chunkSize<file.size});
   root ||= /<HealthData(?=[\s>])/.test(buffer);closed ||= /<\/HealthData\s*>/.test(buffer);
   let cursor=0;
   while(true){
    const start=buffer.indexOf('<Record',cursor);
    if(start<0){buffer=buffer.slice(Math.max(cursor,buffer.length-64));break;}
    const boundary=buffer[start+7];if(boundary&&!/[\s/>]/.test(boundary)){cursor=start+7;continue;}
    let end=start+7,quote='';
    for(;end<buffer.length;end++){const c=buffer[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===buffer.length){buffer=buffer.slice(start);if(buffer.length>131072)throw Error('Не удалось прочитать XML. Нужен файл export.xml из «Здоровья».');break;}
    const record=buffer.slice(start,end+1);if(record.includes('HKCategoryTypeIdentifierMenstrualFlow'))collect(record,dates,today);
    cursor=end+1;
   }
   const percent=Math.min(100,Math.floor((offset+chunkSize)/file.size*100));
   if(percent!==lastProgress){self.postMessage({type:'progress',percent});lastProgress=percent;}
  }
  if(!root||!closed)throw Error('Нужен полный export.xml. ZIP сначала распакуй в «Файлах».');
  self.postMessage({type:'done',dates:[...dates].sort()});
 }catch(error){self.postMessage({type:'error',message:error.message||'Не удалось прочитать файл.'});}
};
