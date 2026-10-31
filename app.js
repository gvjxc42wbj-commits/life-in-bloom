/* Sleep in Bloom — no accounts, cloud services or analytics. */
'use strict';
const STORAGE_KEY = 'sleep-in-bloom.records.v1';
const STATUS = ['sleep', 'rest', 'awake'];
const COLORS = [
  {label:'<4 hrs', color:'#d8e8f5'},
  {label:'4–5 hrs', color:'#c0d4ed'},
  {label:'5–6 hrs', color:'#cbb9e8'},
  {label:'6–7 hrs', color:'#e4bfe9'},
  {label:'7–8 hrs', color:'#dda1d3'},
  {label:'8–9 hrs', color:'#a98ad1'},
  {label:'9+ hrs', color:'#745796'},
];
const $ = selector => document.querySelector(selector);
const content = $('#content');
const noticeEl = $('#notice');
const today = new Date();
const state = {
  year: today.getFullYear(),
  month: today.getMonth(),
  date: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,
  view: 'month',
  mode: 'sleep',
  records: loadRecords()
};

function escapeText(str){return String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function dateKey(year,month,day){return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
function parseDate(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d);}
function dayCount(year,month){return new Date(year,month+1,0).getDate();}
function dateLong(key){return parseDate(key).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});}
function dateMedium(key){return parseDate(key).toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function shiftDate(key,n){const date=parseDate(key);date.setDate(date.getDate()+n);return dateKey(date.getFullYear(),date.getMonth(),date.getDate());}
function monthLabel(){return new Date(state.year,state.month,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});}
function recordFor(key){return state.records[key]||{slots:{},quality:'',notes:''};}
function slotValues(key){return Object.values(recordFor(key).slots||{});}
function hasSlots(key){return Object.keys(recordFor(key).slots||{}).length>0;}
function sleepHours(key){return slotValues(key).filter(s=>s==='sleep').length/2;}
function restHours(key){return slotValues(key).filter(s=>s==='rest').length/2;}
function awakeHours(key){return slotValues(key).filter(s=>s==='awake').length/2;}
function sleepEpisodes(key){let episodes=0, longest=0, run=0;const slots=recordFor(key).slots||{};for(let i=0;i<48;i++){if(slots[i]==='sleep'){if(!run)episodes++;run++;longest=Math.max(longest,run);}else run=0;}return {episodes,longest:longest/2};}
function colorFor(hours){if(hours<4)return COLORS[0].color;if(hours<5)return COLORS[1].color;if(hours<6)return COLORS[2].color;if(hours<7)return COLORS[3].color;if(hours<8)return COLORS[4].color;if(hours<9)return COLORS[5].color;return COLORS[6].color;}
function monthKeys(){return Array.from({length:dayCount(state.year,state.month)},(_,i)=>dateKey(state.year,state.month,i+1));}
function formatHour(value){return Number.isInteger(value)?String(value):value.toFixed(1);}
function validateRecords(candidate){
  const cleaned={};
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return cleaned;
  let days=0;
  for(const [key,r] of Object.entries(candidate)){
    if(days>=4000)break;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!r||typeof r!=='object')continue;
    const dt=parseDate(key);if(Number.isNaN(dt.getTime())||dateKey(dt.getFullYear(),dt.getMonth(),dt.getDate())!==key)continue;
    const slots={};
    for(const [raw,val] of Object.entries(r.slots||{})){
      const n=Number(raw);
      if(Number.isInteger(n)&&n>=0&&n<48&&STATUS.includes(val))slots[n]=val;
    }
    cleaned[key]={slots,quality:['Poor','Okay','Restful'].includes(r.quality)?r.quality:'',notes:typeof r.notes==='string'?r.notes.slice(0,3000):''};
    days++;
  }
  return cleaned;
}
function loadRecords(){try{return validateRecords(JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'));}catch(e){return {};}}
function saveRecords(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state.records));noticeEl.hidden=true;}
  catch(e){showNotice('Your device could not save the entry. Please export a backup before closing the app.',true);}
}
function showNotice(text,error=false){noticeEl.textContent=text;noticeEl.hidden=false;noticeEl.classList.toggle('error',error);}
function changeView(view){state.view=view;render();window.scrollTo({top:0,behavior:'smooth'});}
function openDate(key){state.date=key;const dt=parseDate(key);state.year=dt.getFullYear();state.month=dt.getMonth();changeView('day');}
function renderKeepScroll(){const y=window.scrollY;render();requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'instant'}));}
function statsForMonth(){const keys=monthKeys().filter(hasSlots);const hours=keys.reduce((sum,key)=>sum+sleepHours(key),0);return {keys, total:hours,average:keys.length?hours/keys.length:null};}
function headerForMonth(){return `<div class="month-nav"><div class="nav-group"><button class="nav-btn" data-action="prev-month" aria-label="Previous month">‹</button><button class="nav-btn" data-action="next-month" aria-label="Next month">›</button></div><h2>${monthLabel()}</h2><button type="button" class="today-btn" data-action="this-month">This month</button></div>`;}
function renderMonth(){
  const metrics=statsForMonth();
  let html=`${headerForMonth()}<div class="stats">
    <div class="stat"><div class="stat-label">Days with sleep logged</div><div class="stat-value">${metrics.keys.length}<span style="font-size:14px;color:#a09ab2">/${dayCount(state.year,state.month)}</span></div><div class="stat-foot">No entries are assumed</div></div>
    <div class="stat"><div class="stat-label">Average logged sleep</div><div class="stat-value">${metrics.average===null?'—':formatHour(Math.round(metrics.average*10)/10)}<span style="font-size:13px"> ${metrics.average===null?'':'hrs'}</span></div><div class="stat-foot">Only days with entries</div></div>
    <div class="stat"><div class="stat-label">Reference goal</div><div class="stat-value">8<span style="font-size:13px"> hrs</span></div><div class="stat-foot">Not a pass/fail score</div></div>
  </div><div class="panel"><div class="panel-title-row"><h2>Your monthly sleep log</h2><span class="pill">Tap a day ↗</span></div>
  <div class="month-table-scroll"><div class="month-table"><div class="month-heading"><span class="day-label">Day</span>${Array.from({length:12},(_,i)=>`<span>${i+1}</span>`).join('')}<span>Hrs</span></div>`;
  for(let day=1;day<=dayCount(state.year,state.month);day++){
    const key=dateKey(state.year,state.month,day), sleep=sleepHours(key), logged=hasSlots(key), col=colorFor(sleep);
    html+=`<button type="button" class="month-row" data-open-date="${key}" aria-label="Open ${dateLong(key)}; ${logged?formatHour(sleep)+' hours of sleep recorded':'not logged'}">
      <span class="day-number ${key===dateKey(today.getFullYear(),today.getMonth(),today.getDate())?'today':''}">${day}</span>`;
    for(let d=1;d<=12;d++){
      const fill=logged&&(sleep>=d?'full':sleep>=d-.5?'half':'');
      html+=`<span class="dot ${fill}" style="--cat:${col}" aria-hidden="true"></span>`;
    }
    html+=`<span class="row-total">${logged?formatHour(sleep):'—'}</span></button>`;
  }
  html+=`</div></div><div class="dot-key"><span><i class="dot-example"></i> 1 hour</span><span><i class="dot-example half"></i> 30 minutes</span><span><i class="dot-example blank"></i> Not recorded</span></div><div class="hint"><strong>How to read it:</strong> Circles fill as you record actual or estimated sleep on each day. If you sleep more than 12 hours, the row shows the real total even though there are only 12 circles. Tap any row for a detailed 24-hour log.</div></div>`;
  return html;
}
function clockLabel(slot){
  const totalMinutes=((8*60)+(slot*30))%(24*60);
  const hrs=Math.floor(totalMinutes/60),mins=totalMinutes%60;
  return `${hrs%12||12}:${String(mins).padStart(2,'0')} ${hrs<12?'AM':'PM'}`;
}
function rangeOptions(startAt=0,endAt=48){
  let result='';for(let i=startAt;i<=endAt;i++)result+=`<option value="${i}">${clockLabel(i)}${i===48?' (next day)':''}</option>`;return result;
}
function renderDay(){
  const rec=recordFor(state.date),slots=rec.slots||{},sleep=sleepHours(state.date),rest=restHours(state.date),episodes=sleepEpisodes(state.date);
  let html=`<div class="panel"><div class="detail-head"><div><span class="pill">MY DAILY SLEEP LOG</span><h2>${dateLong(state.date)}</h2><p class="sub">Tracking window: 8 AM today → 8 AM the next day</p></div><div class="detail-actions"><button class="mini-btn" data-action="back-month">‹ Month</button></div></div>
  <div class="detail-stats"><div class="detail-stat"><small>Sleep logged</small><strong>${formatHour(sleep)} hrs</strong></div><div class="detail-stat"><small>Rest / unsure</small><strong>${formatHour(rest)} hrs</strong></div><div class="detail-stat"><small>Sleep blocks</small><strong>${episodes.episodes}</strong></div></div>
  <div class="hint">Unmarked sections mean <strong>unknown</strong>. You can leave uncertain periods blank, or mark them <strong>rest / unsure</strong>. A sleep block is one uninterrupted group of logged 30-minute periods, not proof you slept continuously.</div>
  <div class="panel-title-row" style="margin-top:20px;margin-bottom:4px"><h3>Choose your tracking mode</h3><span class="muted tiny">Tap the time squares</span></div>
  <div class="status-picker" role="group" aria-label="Sleep timeline mark type">
    <button type="button" data-mode="sleep" class="status-btn sleep ${state.mode==='sleep'?'selected':''}" aria-pressed="${state.mode==='sleep'}">☾ Asleep</button>
    <button type="button" data-mode="rest" class="status-btn rest ${state.mode==='rest'?'selected':''}" aria-pressed="${state.mode==='rest'}">◇ Rest / unsure</button>
    <button type="button" data-mode="awake" class="status-btn awake ${state.mode==='awake'?'selected':''}" aria-pressed="${state.mode==='awake'}">☀ Awake</button>
    <button type="button" data-mode="erase" class="status-btn erase ${state.mode==='erase'?'selected':''}" aria-pressed="${state.mode==='erase'}">⌫ Erase</button>
  </div><p class="timeline-guide">Each square represents <strong>30 minutes</strong>. Starting at 8 AM captures daytime naps, nighttime sleep, and waking periods in the same day.</p>`;
  for(let g=0;g<4;g++){
    const first=g*12,last=(g+1)*12;
    html+=`<section class="time-group"><div class="time-group-label">${clockLabel(first)} — ${clockLabel(last)}${last===48?' (next day)':''}</div><div class="timeline-hours">`;
    for(let i=0;i<6;i++)html+=`<span>${clockLabel(first+i*2).replace(':00','')}</span>`;
    html+=`</div><div class="time-slots">`;
    for(let i=first;i<last;i++){
      const kind=slots[i]||'empty';
      html+=`<button type="button" data-slot="${i}" class="time-block ${kind}" aria-label="${clockLabel(i)}–${clockLabel(i+1)}: ${kind==='empty'?'not marked':kind}" aria-pressed="${kind!=='empty'}" title="${clockLabel(i)}–${clockLabel(i+1)}: ${kind}"><span class="halfmark" aria-hidden="true"></span></button>`;
    }
    html+=`</div></section>`;
  }
  html+=`<div class="status-key"><span><i class="key-dot" style="background:#9b83cd"></i> Asleep</span><span><i class="key-dot" style="background:#e4b2d3"></i> Rest / unsure</span><span><i class="key-dot" style="background:#b9d5e8"></i> Awake</span><span><i class="key-dot" style="background:#f9f7fa;border:1px solid #dfd5eb"></i> Unknown</span></div></div>
  <section class="panel"><div class="panel-title-row"><h2>Fill a time range</h2><span class="pill">Faster logging</span></div>
    <div class="form-row"><div class="form-field"><label for="range-start">From</label><select id="range-start">${rangeOptions(0,47)}</select></div><div class="form-field"><label for="range-end">Until</label><select id="range-end">${rangeOptions(1,48)}</select></div></div>
    <div class="form-actions"><button type="button" class="button primary" data-action="fill-range">Apply chosen mode</button></div>
    <p class="warn-text">Choose times within this 8 AM–8 AM day. To log sleep across two tracking days, make an entry in each one. This starter version uses 30-minute increments.</p>
  </section><section class="panel"><h2>How did you feel?</h2><p class="muted tiny">Sleep quality is your own rating — it doesn't depend on the hour count.</p>
  <div class="quality-row">${['Poor','Okay','Restful'].map(q=>`<button type="button" class="quality ${rec.quality===q?'active':''}" data-quality="${q}" aria-pressed="${rec.quality===q}">${q}</button>`).join('')}</div>
  <div class="form-field" style="margin-top:18px"><label for="notes">Notes / wake-ups / smoking or withdrawal changes</label><textarea id="notes" maxlength="3000" placeholder="What do I remember about sleeping today? Did I nap or wake up?">${escapeText(rec.notes||'')}</textarea></div>
  <div class="form-actions" style="display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap"><button type="button" class="button" data-action="clear-day">Clear this day's log</button><span class="tiny muted">Saved automatically on this device</span></div></section>
  <div class="panel" style="display:flex;justify-content:space-between;gap:8px"><button type="button" class="button" data-action="prev-day">← Previous</button><button type="button" class="button primary" data-action="back-month">Back to month</button><button type="button" class="button" data-action="next-day">Next →</button></div>`;
  return html;
}
function polar(cx,cy,r,angle){return {x:cx+r*Math.cos(angle),y:cy+r*Math.sin(angle)};}
function sector(cx,cy,inner,outer,start,end){const a=polar(cx,cy,outer,start),b=polar(cx,cy,outer,end),c=polar(cx,cy,inner,end),d=polar(cx,cy,inner,start);return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${outer} ${outer} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} A ${inner} ${inner} 0 0 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Z`;}
function renderCircle(){
  const all=monthKeys(), n=all.length,metrics=statsForMonth();
  let svg=`<svg viewBox="0 0 420 420" role="img" aria-label="Circular monthly tracker. Tap a numbered segment to open that day."><defs><radialGradient id="moonHalo"><stop offset="0" stop-color="#fcf5ff"/><stop offset="1" stop-color="#fff9fd"/></radialGradient></defs><circle cx="210" cy="210" r="184" fill="#faf7fd"/>`;
  for(let i=0;i<n;i++){
    const k=all[i],hrs=sleepHours(k),filled=hasSlots(k),t0=-Math.PI/2+i*2*Math.PI/n,t1=-Math.PI/2+(i+1)*2*Math.PI/n;
    const pt=polar(210,210,167,(t0+t1)/2);const fill=filled?colorFor(hrs):'#fff';
    svg+=`<g class="ring-day" data-open-date="${k}" role="button" tabindex="0" aria-label="${dateLong(k)}: ${filled?formatHour(hrs)+' hours sleep logged':'no sleep logged'}"><title>${dateLong(k)}: ${filled?formatHour(hrs)+' hours logged':'not logged'}</title><path d="${sector(210,210,143,183,t0,t1)}" fill="${fill}" stroke="#998ab3" stroke-width="1.2"/><text x="${pt.x.toFixed(1)}" y="${pt.y.toFixed(1)}">${i+1}</text></g>`;
  }
  svg+=`<circle cx="210" cy="210" r="135" fill="url(#moonHalo)" stroke="#e6d8ee" stroke-width="1.5"/><circle cx="194" cy="207" r="70" fill="#d8c8f4"/><circle cx="229" cy="174" r="70" fill="#fcf5ff"/><g fill="#d5b1a0"><text x="132" y="157" font-size="21">✦</text><text x="297" y="225" font-size="25">✧</text><text x="158" y="286" font-size="17">✧</text><text x="280" y="144" font-size="15">✦</text></g><text x="210" y="311" text-anchor="middle" font-family="Georgia,serif" font-size="15" fill="#947caa">rest • restore • bloom</text></svg>`;
  return `${headerForMonth()}<section class="panel"><div class="panel-title-row"><h2>Your monthly moon wheel</h2><span class="pill">Tap a segment</span></div><div class="wheel-wrap">${svg}</div><div class="wheel-legend">${COLORS.map(c=>`<div class="legend-item"><span class="legend-color" style="background:${c.color}"></span>${c.label}</div>`).join('')}</div><p class="caption">One segment per day. Empty means no sleep blocks have been logged. Every color is information, not a grade.</p></section>
  <section class="panel"><h2>Month at a glance</h2><div class="summary-row"><span>Days with sleep entries</span><strong>${metrics.keys.length} of ${n}</strong></div><div class="summary-row"><span>Average sleep recorded</span><strong>${metrics.average===null?'Not enough information':formatHour(Math.round(metrics.average*10)/10)+' hrs'}</strong></div><div class="summary-row"><span>Logged sleep hours (total)</span><strong>${formatHour(metrics.total)} hrs</strong></div><div class="summary-row"><span>Nightly reference target</span><strong>8 hrs, flexible</strong></div><div class="hint">The wheel shows the hours recorded in each 8 AM–8 AM day. It cannot tell whether you were genuinely asleep without a reliable observation or device measurement.</div></section>`;
}
function render(){
  for(const btn of document.querySelectorAll('.view-tab')){const active=btn.dataset.view===state.view;btn.classList.toggle('active',active);if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');}
  content.innerHTML=state.view==='day'?renderDay():state.view==='circle'?renderCircle():renderMonth();
}
function switchMonth(delta){const dt=new Date(state.year,state.month+delta,1);state.year=dt.getFullYear();state.month=dt.getMonth();if(state.view==='day')state.date=dateKey(state.year,state.month,1);render();}
function commitSlot(idx){const key=state.date,prev=recordFor(key),slots={...(prev.slots||{})};if(state.mode==='erase'||slots[idx]===state.mode)delete slots[idx];else slots[idx]=state.mode;state.records[key]={...prev,slots};saveRecords();renderKeepScroll();}
function setQuality(q){const key=state.date,old=recordFor(key);state.records[key]={...old,quality:old.quality===q?'':q};saveRecords();renderKeepScroll();}
function fillRange(){
  const start=Number($('#range-start').value),end=Number($('#range-end').value);
  if(!(start>=0&&start<48&&end>start&&end<=48))return showNotice('Please choose an end time later than the start time within this tracking day.',true);
  if(state.mode==='erase')return showNotice('Select Asleep, Rest / unsure, or Awake before applying a range.',true);
  const key=state.date,rec=recordFor(key),slots={...(rec.slots||{})};for(let i=start;i<end;i++)slots[i]=state.mode;state.records[key]={...rec,slots};saveRecords();renderKeepScroll();showNotice(`Recorded ${clockLabel(start)} to ${clockLabel(end)} as ${state.mode}.`);
}
content.addEventListener('click',event=>{
  const open=event.target.closest('[data-open-date]');if(open){openDate(open.dataset.openDate);return;}
  const slot=event.target.closest('[data-slot]');if(slot){commitSlot(Number(slot.dataset.slot));return;}
  const mode=event.target.closest('[data-mode]');if(mode){state.mode=mode.dataset.mode;renderKeepScroll();return;}
  const quality=event.target.closest('[data-quality]');if(quality){setQuality(quality.dataset.quality);return;}
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='prev-month')switchMonth(-1);
  if(action==='next-month')switchMonth(1);
  if(action==='this-month'){state.year=today.getFullYear();state.month=today.getMonth();render();}
  if(action==='back-month')changeView('month');
  if(action==='prev-day')openDate(shiftDate(state.date,-1));
  if(action==='next-day')openDate(shiftDate(state.date,1));
  if(action==='fill-range')fillRange();
  if(action==='clear-day'){
    if(window.confirm(`Clear all sleep blocks, notes and quality for ${dateLong(state.date)}?`)){delete state.records[state.date];saveRecords();renderKeepScroll();}
  }
});
content.addEventListener('keydown',event=>{const open=event.target.closest('.ring-day[data-open-date]');if(open&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openDate(open.dataset.openDate);}});
content.addEventListener('input',event=>{if(event.target.id==='notes'){const key=state.date;state.records[key]={...recordFor(key),notes:event.target.value};saveRecords();}});
for(const btn of document.querySelectorAll('.view-tab'))btn.addEventListener('click',()=>changeView(btn.dataset.view));
$('#help-btn').addEventListener('click',()=>$('#help-dialog').showModal());
$('#close-help').addEventListener('click',()=>$('#help-dialog').close());
$('#got-it-btn').addEventListener('click',()=>$('#help-dialog').close());
$('#export-btn').addEventListener('click',()=>{
  const backup={app:'Sleep in Bloom',version:1,exportedAt:new Date().toISOString(),records:state.records};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`sleep-in-bloom-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);showNotice('Your backup was prepared. Keep the downloaded JSON file somewhere safe.');
});
$('#import-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>3_000_000){showNotice('This backup is larger than expected (3 MB maximum).',true);event.target.value='';return;}
  try{
    const data=JSON.parse(await file.text());if(!data||data.app!=='Sleep in Bloom'||data.version!==1||!data.records||typeof data.records!=='object')throw new Error('Invalid Sleep in Bloom file.');
    if(window.confirm('Importing this backup will REPLACE the sleep entries currently stored on this device. Continue?')){
      state.records=validateRecords(data.records);saveRecords();render();showNotice('Your sleep entries were imported successfully.');
    }
  }catch(e){showNotice('Could not import the file. Choose a valid Sleep in Bloom JSON backup.',true);}finally{event.target.value='';}
});
render();
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
}
