const pid=(String(args.sku||'').match(/products\/(\d+)/)||[])[1]
const cu=await page.url()
if(args.sku&&!/order-form/.test(cu)&&!(pid&&cu.includes(pid))){
await tabs.open({url:args.sku,profile:args.profile||args.account})
for(let i=0;i<15&&!(pid&&(await page.url()).includes(pid));i++)await sleep(1000)
}
const onOrder=/order-form/.test(await page.url())
if(!onOrder)await page.waitFor('구매하기',12000).catch(()=>{})
const safe=async(fn,d)=>{for(let i=0;i<3;i++){try{return await fn()}catch{await sleep(1500)}}return d}
const text=async(s)=>{const t=(await page.get(s?{selector:s}:{})).tree;return t.slice(t.indexOf('PAGE TEXT'))}
const it=async()=>(await safe(()=>page.get({interactive:true}),{tree:''})).tree.split('\n')
let ln=await it()
const ID=l=>+l.match(/^\[(\d+)\]/)[1]
const ck=i=>page.click(i)
const idL=(arr,re)=>{const l=arr.find(x=>re.test(x));const m=l&&l.match(/^\[(\d+)\]/);return m?Number(m[1]):null}
const hs=ln.some(l=>/선택 목록 열기|선택 목록 닫기/.test(l))
let op=[],chosen='',pk=!hs
const norm=s=>s.toLowerCase().replace(/[\s_\-·]/g,'')
const w=norm(String(args.size||'')).replace(/gray/g,'grey')
const KO={블랙:'black',화이트:'white',그레이:'grey',핑크:'pink',베이지:'beige',네이비:'navy'}
const wEn=Object.keys(KO).reduce((s,k)=>s.split(k).join(KO[k]),w)
const ch=n=>{n=norm(n);return !!n&&(w.includes(n)||wEn.includes(n))}
const CRE=/textbox "(색상|컬러|컬러\(Color\)|Color)"/i
const SRE=/textbox "(사이즈|size)"/i
const ARRRE=/clickable "(.*(?:발송 예정|도착보장|도착 예정)|.*\(품절\))"/
const rd1=async()=>{
const p=await text()
const end=p.search(/장바구니\s+(?:\S+\s+)?구매하기/)
const head=p.slice(0,end<0?p.length:end)
let st=-1
const pr=/\d+%\s*[\d,]+원|[\d,]+원/g
let pm
while((pm=pr.exec(head)))st=pm.index+pm[0].length
if(st<0)st=Math.max(0,head.lastIndexOf('LV.'))
let seg=head.slice(st)
const mi=seg.lastIndexOf('더보기')
if(mi>=0&&/이내 발송|도착보장|발송 예정|도착 예정/.test(seg.slice(mi)))seg=seg.slice(mi+3)
else seg=seg.replace(/^.*?LV\.\d+\s*\S+\s*/,m=>m.length<200?'':m)
const re=/(.+?)\s*(?:(?:\S+\([^)]*\)\s+)?(?:이내 )?(?:발송 예정|도착보장|도착 예정|출발)(?:\s*오늘출발)?(?:\s*\d+개 남음)?|\(품절\))/g
const R=[]
let m
while((m=re.exec(seg))){let nm=m[1].replace(/재입고 알림|마지막 \d+개|\d+개 남음/g,'').trim().replace(/^.*?추가\s*적립\s*/,'').trim();if(nm.length>40)nm=nm.split(/\s+/).pop();R.push({name:nm,so:/\(품절\)/.test(m[0])})}
return R
}
const rd3=async()=>{
let p=await text('[class*=Option]')
const k=p.lastIndexOf('비밀글 제외')
const seg=k>=0?p.slice(k):p
const re=/(?:^|\s)((?:[A-Za-z가-힣]+\s)?\d{2,3}(?:mm)?|[A-Z]{1,3}|FREE|프리)\s+(?:(?:\S+\([^)]*\)\s+)?(?:이내 )?(?:발송 예정|도착보장|도착 예정)|(\(품절\)))/g
const R=[],seen=new Set()
let m
while((m=re.exec(seg))){const nm=m[1].trim();if(seen.has(nm))break;seen.add(nm);R.push({name:nm,so:!!m[2]})}
return R
}
const rd2=(L)=>{
const start=Math.max(0,L.findIndex(l=>SRE.test(l)))
let endI=L.findIndex((l,i)=>i>start&&/button "(좋아요|장바구니|[^"]*구매하기[^"]*)"/.test(l))
if(endI<0)endI=L.length
const R=[]
for(const l of L.slice(start+1,endI)){
const m=l.match(/^\[(\d+)\] clickable "([^"]+)"/)
if(!m||/선택 목록/.test(m[2])||/^(\d+개 남음|마지막 \d+개)$/.test(m[2]))continue
const so=/\(품절\)/.test(m[2])
R.push({id:Number(m[1]),name:!so&&/도착|발송|배송|출고/.test(m[2])?'(옵션'+(R.length+1)+')':m[2].replace(/\(품절\)/,'').trim(),so})
}
return R
}
const segOf=L=>{const a=L.findIndex(l=>CRE.test(l)),b=L.findIndex(l=>SRE.test(l));return L.slice(a+1,b>a?b:a+8)}
const pc=async()=>{
for(let tr=0;tr<2;tr++){
let L=await it()
const ci=L.findIndex(l=>CRE.test(l))
if(ci<0||/textbox "[^"]+" value="[^"]+"/.test(L[ci]))return
if(!segOf(L).some(l=>/선택 목록 닫기/.test(l))){
const oid=idL(segOf(L),/button "선택 목록 열기"/)
if(oid){await ck(oid);await sleep(1200)}
L=await it()
}
const cands=segOf(L).map(l=>l.match(/^\[(\d+)\] clickable "([^"]+)"/)).filter(Boolean).map(m=>({id:Number(m[1]),name:m[2]}))
let pick=cands.filter(c=>ch(c.name)).sort((a,b)=>norm(b.name).length-norm(a.name).length)[0]
if(!pick&&cands.length===1)pick=cands[0]
if(!pick)return
await(tr?page.clickNative(pick.id):page.click(pick.id))
await sleep(1500)
}
}
if(onOrder)pk=true
else if(hs){
await pc()
for(let at=0;at<3&&!pk;at++){
ln=await it()
if(ln.some(l=>/옵션 삭제/.test(l))){pk=true;break}
const after=ln.slice(ln.findIndex(l=>SRE.test(l))+1)
if(!after.some(l=>/선택 목록 닫기/.test(l))){
const oi=idL(after,/button "선택 목록 열기"/)
if(oi){await ck(oi);await sleep(1200)}
}
ln=await it()
for(let rf=0,rid;rf<3&&(rid=idL(ln,/button "새로고침"/));rf++){await ck(rid);await sleep(2500);ln=await it()}
const ids=L=>L.slice(L.findIndex(l=>SRE.test(l))+1).filter(l=>ARRRE.test(l)).map(l=>ID(l))
let ri=ids(ln)
let R=await safe(rd1,[])
if(!R.length||R.length<ri.length||R.some(r=>r.name.length>80)){
const r3=await safe(rd3,[])
if(r3.length&&r3.length>=ri.length)R=r3
else{R=rd2(ln);ri=R.map(r=>r.id)}
}
op=R.map(r=>r.name+(r.so?' (품절)':''))
const txo=!ri.length&&R.length&&!R.some(r=>/^\(옵션\d+\)$/.test(r.name))
if(!txo&&R.some(r=>/^\(옵션\d+\)$/.test(r.name)))return{options:op,note:'unreadable'}
let best=-1,bs=0
R.forEach((r,i)=>{
if(r.so)return
const n=norm(r.name)
const s=n&&w.includes(n)?100+n.length:(r.name.match(/\d+|[A-Za-z]+/g)||[]).filter(t=>w.includes(t.toLowerCase())).length
if(s>bs){bs=s;best=i}
})
if(best<0||bs<1)break
if(txo){
const k=R.slice(0,best).filter(r=>!r.so).length
let L3=await it()
if(!L3.some(l=>/선택 목록 닫기/.test(l))){const o=idL(L3.slice(L3.findIndex(l=>SRE.test(l))+1),/button "선택 목록 열기"/);if(o){await ck(o);await sleep(1200);L3=await it()}}
const tids=L3.slice(L3.findIndex(l=>SRE.test(l))+1).filter(l=>/clickable "[^"]*(발송 예정|도착보장|도착 예정)/.test(l)).map(l=>ID(l))
if(tids[k])await ck(tids[k])
else break
}else{
const all=[]
let tg=0
for(let k=0;k<20&&!tg;k++){
const cur=ids(ln)
cur.forEach(i=>all.includes(i)||all.push(i))
all.sort((a,b)=>a-b)
if(all.length>best&&cur.includes(all[best]))tg=all[best]
if(tg||!cur.length)break
try{await page.scroll('down',cur[cur.length-1])}catch{break}
ln=await it()
if(ids(ln).join()===cur.join())break
}
if(!tg)break
await ck(tg)
}
chosen=R[best].name
let l2=await it()
for(let q=0;q<6&&!l2.some(l=>/옵션 삭제/.test(l));q++){await sleep(1200);l2=await it()}
pk=l2.some(l=>/옵션 삭제/.test(l))
const cl=!pk&&idL(l2,/button "선택 목록 닫기"/)
if(cl)await ck(cl)
}
}
if(!pk)return{options:op,note:'nopick'}
if(!onOrder){
ln=await it()
const bi=idL(ln,/button "(?![^"]*장바구니)[^"]*구매하기[^"]*"/)
if(bi)await ck(bi)
else if(!hs){try{await page.clickText('구매하기',0)}catch{return{options:op,note:'no buy button'}}}
else return{options:op,note:'no buy button'}
await sleep(1200)
const bb=idL(await it(),/button "바로 구매하기"/)
if(bb)await ck(bb)
}
let t=''
for(let i=0;i<12;i++){
await sleep(1000)
t=await safe(()=>text('body'),'')
if(/주문 상품/.test(t)&&/총 결제 금액/.test(t))break
}
const cm=t.match(/총 결제 금액\s*(?:\d+%\s*)?([\d,]+)\s*원/)
const cost=cm?Number(cm[1].replace(/,/g,'')):null
const tail=t.slice(t.indexOf('주문 상품'))
const sm=tail.match(/(\S+(?:\s*·\s*\S+)+)\s*\/\s*\d+개/)||t.match(/주문 상품 \d+개\s*(.+?)\s*\/\s*\d+개/)
let selected=sm?sm[1].trim():''
if(sm&&/·/.test(sm[1])){const b=tail.slice(0,tail.indexOf(sm[0])).trim().split(/\s+/);const e=[];for(let i=b.length-1;i>=0&&b[i]&&!/_|^·$/.test(b[i])&&norm(b[i])&&(w.includes(norm(b[i]))||wEn.includes(norm(b[i])));i--)e.unshift(b[i]);if(e.length)selected=e.concat(sm[1]).join(' ')}
const pn=(String(args.size||'').match(/[A-Z][A-Z0-9]{5,}\s*$/)||[])[0]
if(selected&&pn&&!selected.includes(pn)){const ns=norm(selected);if(tail.slice(0,300).includes(pn)||args.size.replace(pn,'').split(/\s+/).filter(Boolean).every(x=>ns.includes(norm(x))))selected+=' '+pn}
const si0=t.lastIndexOf('결제 수단')
const ms=si0>=0?t.slice(si0,si0+400):t
const MN=['무신사머니','무신사페이','토스페이','카카오페이','페이코','네이버페이','카드','가상계좌']
const methods=MN.filter(n=>ms.includes(n))
if(!op.length)op=selected?[selected.split(/\s+/).pop()]:[]
return{cost,options:op,methods,selected,chosen:chosen||op[0]||'',qty:+(tail.match(/\/\s*(\d+)개/)||[])[1]||null}