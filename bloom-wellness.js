/* Shared water records and the connected Home dashboard. Quantities are observations, not prescribed targets. */
(function (root) {
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2});
  const money=value=>value==null?'Not available':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
  const uuid=()=>root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : '10000000-1000-4000-8000-'.replace(/[18]/g,c=>(Number(c)^Math.random()*16>>Number(c)/4).toString(16))+Math.random().toString(16).slice(2,14).padEnd(12,'0');
  function dayKey(date) { const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date||new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-'); }
  function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value||'') && value>='1900-01-01' && value<='2200-12-31' && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value; }
  const dateLabel=value=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'}):'Choose a date';
  function sharedRows(current,key) { const household=current&&current.household&&current.household.id;return household?(current[key]||[]).filter(row=>row&&row.household_id===household):[]; }
  const ML_PER_CUP = 236.5882365;
  function cupsFromMl(value) {
    const amount=Number(value);
    return Number.isFinite(amount)&&amount>=0?amount/ML_PER_CUP:0;
  }
  function mlFromCups(value) {
    const amount=Number(value);
    return Number.isFinite(amount)?amount*ML_PER_CUP:NaN;
  }
  function cupLabel(value) {
    const amount=cupsFromMl(value);
    const rounded=Math.round(amount*100)/100;
    return fmt(rounded)+' cup'+(Math.abs(rounded-1)<0.005?'':'s');
  }
  function waterSummary(current,date,person) {
    const settings=sharedRows(current,'hydrationSettings').find(row=>!row.archived && Number(row.person_slot)===Number(person));
    const entries=sharedRows(current,'hydrationEntries').filter(row=>!row.archived && row.occurred_on===date && Number(row.person_slot)===Number(person));
    const total=entries.reduce((sum,row)=>sum+(Number(row.amount_ml)>0?Number(row.amount_ml):0),0);
    const container=settings && Number(settings.container_ml)>0?Number(settings.container_ml):250;
    return {settings,entries,totalMl:total,containerMl:container,containerCount:total/container,goalMl:settings && settings.goal_ml!=null?Number(settings.goal_ml):null,logged:entries.length>0};
  }
  function boostSummary(current,date,person) {
    const products=sharedRows(current,'products').filter(row=>row.category==='food'&&/\bboost\b/i.test((row.brand||'')+' '+row.name));
    const product=products.find(row=>!row.archived)||null,ids=new Set(products.map(row=>row.id));
    const entries=sharedRows(current,'mealEntries').filter(row=>!row.archived&&!row.voided_at&&row.kind==='eaten' && row.occurred_on===date && Number(row.person_slot)===Number(person) && ids.has(row.product_id));
    const perPackage=Number(product&&product.servings_per_package)>0?Number(product.servings_per_package):1;
    const stock=product?sharedRows(current,'inventory').filter(row=>row.product_id===product.id&&Number(row.quantity)>0).reduce((sum,row)=>{
      const remaining=Number(row.servings_remaining);
      if(Number.isFinite(remaining)&&remaining>=0)return sum+remaining;
      const quantity=Number(row.quantity)||0,unit=String(row.unit||'').toLowerCase();
      return sum+(unit.includes('pack')||unit.includes('case')?quantity*perPackage:quantity);
    },0):0;
    return {product,servings:entries.reduce((sum,row)=>sum+Number(row.servings||0),0),logged:entries.length>0,stock:Math.max(0,Math.floor(stock))};
  }
  function createController(options) {
    options=options||{};const store=options.store,notify=options.notify||(()=>{}),refresh=options.refresh||(()=>{}),navigate=options.navigate||(()=>{});
    const confirm=options.confirm||(()=>true),getNow=options.getNow||(()=>new Date()),draftStore=options.draftStore;
    let identity='',generation=0,busy=false,promise=Promise.resolve(),selectedDate=dayKey(getNow()),lastToday=selectedDate,viewSerial=0,form=null,baseline=null,pending=null,saved=false,draftWarning=false;
    function ready(current) { return current && current.status==='ready' && current.user && current.household; }
    function snapshot() {
      const current=store.snapshot()||{},key=current.user&&current.household?current.user.id+'|'+current.household.id:'';
      if(key!==identity) {identity=key;generation++;busy=false;selectedDate=dayKey(getNow());lastToday=selectedDate;viewSerial=0;form=null;baseline=null;pending=null;saved=false;draftWarning=false;
        let stored=null;
        try {stored=key && draftStore && draftStore.read(current.user.id,current.household.id,'wellness');}
        catch(_){notify('This device could not open your saved water draft. Its stored copy has not been changed.',true);}
        if(stored && stored.data && stored.data.version===1) {const d=stored.data;if(validDate(d.selectedDate))selectedDate=d.selectedDate;if(Number.isSafeInteger(d.viewSerial)&&d.viewSerial>=0)viewSerial=d.viewSerial;
          if(d.form && ['entry','settings'].includes(d.form.type) && [1,2].includes(Number(d.form.person_slot))) {form=clone(d.form);baseline=clone(d.baseline||d.form);}
          if(d.pending && ['entry','settings','archive'].includes(d.pending.action) && d.pending.payload && typeof d.pending.payload.request_id==='string')pending=clone(d.pending);
          saved=true;
        }
      }
      const today=dayKey(getNow());if(today!==lastToday && selectedDate===lastToday && !dirty() && !pending && !busy){selectedDate=today;viewSerial++;if(form&&form.type==='entry'&&form.occurred_on===lastToday){form.occurred_on=today;baseline=clone(form);persist();}}lastToday=today;
      return current;
    }
    function dirty() { return Boolean(form && JSON.stringify(form)!==JSON.stringify(baseline)); }
    function persist() {
      const current=store.snapshot();if(!current||!current.user||!current.household||!draftStore)return;
      try {saved=(form||pending?draftStore.write(current.user.id,current.household.id,'wellness',{version:1,selectedDate,viewSerial,form,baseline,pending}):draftStore.clear(current.user.id,current.household.id,'wellness'))!==false;}
      catch(_){saved=false;}
      if(!saved&&!draftWarning){draftWarning=true;notify('This device could not save your water draft. Keep this page open until it is saved online.',true);}
    }
    function begin(type,person) {
      const current=snapshot();if(!ready(current)){navigate('grocery');return false;}
      if(![1,2].includes(Number(person)))throw new Error('Choose Person 1 or Person 2.');
      if(type==='entry'&&selectedDate>dayKey(getNow()))throw new Error('Future dates are for viewing plans. Log water on the day you actually drank it.');
      if(pending){notify('Confirm the pending water change before starting another one.',true);return false;}
      if(dirty()&&!confirm('Replace this unsaved water draft?'))return false;
      const summary=waterSummary(current,selectedDate,person),existing=type==='settings'?summary.settings:null;
      form=type==='settings'?{type,id:existing&&existing.id||'',revision:existing&&existing.revision||null,request_id:uuid(),person_slot:Number(person),container_ml:String(summary.containerMl),goal_ml:summary.goalMl==null?'':String(summary.goalMl)}:
        {type,id:'',request_id:uuid(),person_slot:Number(person),occurred_on:selectedDate,amount_ml:String(summary.containerMl),container_ml:summary.containerMl,notes:''};
      baseline=clone(form);persist();return true;
    }
    function submitAttempt() {
      const current=snapshot();if(busy||!pending)return;
      if(!ready(current)){notify('Refresh your household records before retrying this water change. Its exact details are kept.',true);return;}
      if(current.offline){notify('Your water entry is kept as a draft. Reconnect, then save it online.',true);return;}
      const attempt=clone(pending),token=generation;busy=true;persist();refresh();
      const call=()=>{snapshot();if(token!==generation)throw new Error('The account changed before this water entry was submitted.');return attempt.action==='archive'?store.archiveLifeRecord(attempt.payload,attempt.payload.request_id):attempt.action==='settings'?store.saveHydrationSettings(attempt.payload):store.saveHydrationEntry(attempt.payload);};
      promise=Promise.resolve().then(call).then(()=>{snapshot();if(token!==generation)return;pending=null;if(attempt.action!=='archive'){form=null;baseline=null;}
        if(attempt.action==='entry'&&(attempt.viewSerial==null?selectedDate===attempt.payload.occurred_on:attempt.viewSerial===viewSerial)){if(selectedDate!==attempt.payload.occurred_on){selectedDate=attempt.payload.occurred_on;viewSerial++;}if(options.onDateChange)options.onDateChange(selectedDate);}
        notify(attempt.action==='archive'?'The water entry was removed from the daily total. Its history remains saved.':'Water saved in Wellness.');})
        .catch(error=>{snapshot();if(token!==generation)return;if(['22023','23514','23505','40001','42501'].includes(String(error.code)))pending=null;notify(error.message||'The save could not be confirmed. Retry keeps the same entry and avoids a duplicate.',true);})
        .finally(()=>{if(token===generation){busy=false;persist();refresh();}});
    }
    function payload() {
      if(!form)throw new Error('Open a water entry first.');const value=clone(form);delete value.type;
      value.person_slot=Number(value.person_slot);if(![1,2].includes(value.person_slot))throw new Error('Choose Person 1 or Person 2.');
      value.container_ml=Number(value.container_ml);if(!Number.isFinite(value.container_ml)||value.container_ml<1||value.container_ml>10000)throw new Error('Choose a container size from 1 to 10,000 mL.');
      if(form.type==='settings') {value.goal_ml=form.goal_ml===''?null:Number(form.goal_ml);if(value.goal_ml!=null&&(!Number.isFinite(value.goal_ml)||value.goal_ml<1||value.goal_ml>30000))throw new Error('Leave the goal blank or enter an amount from 1 to 30,000 mL.');}
      else {value.amount_ml=Number(form.amount_ml);if(!Number.isFinite(value.amount_ml)||value.amount_ml<1||value.amount_ml>30000)throw new Error('Enter the actual water amount from 1 to 30,000 mL.');if(!validDate(value.occurred_on)||value.occurred_on>dayKey(getNow()))throw new Error('Choose today or a past date for water you drank.');if(String(value.notes||'').length>2000)throw new Error('Keep water notes under 2,000 characters.');}
      return value;
    }
    function button(action,label,attrs,primary,disabled) {return '<button type="button" class="button'+(primary?' primary':'')+'" data-wellness-action="'+action+'"'+(attrs||'')+(busy||disabled?' disabled':'')+'>'+label+'</button>';}
    function pendingPanel(current) {return pending?'<section class="panel water-pending" role="status"><h3>Confirm your water change</h3><p>The last save has not been confirmed here. Retry uses the same entry.</p>'+button('retry','Retry the same save','',true,current.offline)+'</section>':'';}
    function field(name,label,type,extra) {return '<label class="water-field" for="water-'+name+'"><span>'+label+'</span><input id="water-'+name+'" name="'+name+'" data-wellness-field="'+name+'" type="'+type+'" value="'+esc(form[name])+'"'+(extra||'')+(busy||pending?' disabled':'')+'></label>';}
    function cupField(sourceName,label,extra) {
      const raw=form[sourceName],cups=raw===''?'':Math.round(cupsFromMl(raw)*100)/100;
      return '<label class="water-field" for="water-'+sourceName+'-cups"><span>'+label+'</span><input id="water-'+sourceName+'-cups" data-wellness-cups="'+sourceName+'" type="number" value="'+esc(cups)+'"'+(extra||'')+(busy||pending?' disabled':'')+'></label>';
    }
    function renderForm(current) {
      if(!form)return '';let html='<section class="panel water-form-panel" id="water-form-panel"><p class="page-kicker">Person '+form.person_slot+'</p><h3>'+(form.type==='settings'?'Your water settings':'Log water you drank')+'</h3><form data-wellness-form="water" class="water-form">';
      if(form.type==='settings')html+='<p class="caption">Choose the number of cups your quick-add button records. A daily goal is optional and is your own preference.</p><div class="water-form-grid">'+cupField('container_ml','Your container size (cups)',' min="0.01" max="42.27" step="0.01" required')+cupField('goal_ml','Your daily goal (cups, optional)',' min="0.01" max="126.8" step="0.01"')+'</div>';
      else html+='<div class="water-form-grid">'+field('occurred_on','Date','date',' required min="1900-01-01" max="'+dayKey(getNow())+'"')+cupField('amount_ml','Water amount (cups)',' required min="0.01" max="126.8" step="0.01"')+'</div><label class="water-field" for="water-notes"><span>Notes (optional)</span><textarea id="water-notes" name="notes" data-wellness-field="notes" maxlength="2000"'+(busy||pending?' disabled':'')+'>'+esc(form.notes)+'</textarea></label>';
      html+='<div class="water-actions"><button type="submit" class="button primary"'+(busy||current.offline?' disabled':'')+'>'+(pending?'Retry the same save':'Save '+(form.type==='settings'?'settings':'water'))+'</button>'+button('close','Close draft','',false,Boolean(pending))+'</div><p class="caption">'+(saved?'Draft saved on this device. Save online to update both people’s shared view.':'Save this entry to keep it in your household history.')+'</p></form></section>';return html;
    }
    function renderWaterCards(current,date,home) {
      const future=date>dayKey(getNow());
      return '<div class="water-people">'+[1,2].map(person=>{const summary=waterSummary(current,date,person),percent=summary.goalMl?Math.min(100,summary.totalMl/summary.goalMl*100):0;
        return '<article class="water-person person-'+person+'"><div class="water-person-heading"><span class="water-drop" aria-hidden="true">💧</span><span>Person '+person+'<strong>Water</strong></span>'+button('settings','⚙',' data-person="'+person+'" aria-label="Water settings for Person '+person+'"')+'</div><strong class="water-number">'+cupLabel(summary.totalMl)+'</strong><p class="water-count">'+fmt(summary.containerCount)+' × '+cupLabel(summary.containerMl)+(summary.logged?' logged':' · none logged')+'</p>'+(summary.goalMl?'<progress value="'+summary.totalMl+'" max="'+summary.goalMl+'" aria-label="Person '+person+' water progress"></progress><p class="caption">Your chosen goal: '+cupLabel(summary.goalMl)+(percent===100?' · reached':'')+'</p>':'<p class="caption">Daily goal not set</p>')+'<div class="water-actions">'+button('add','+ '+cupLabel(summary.containerMl),' data-person="'+person+'" data-date="'+date+'"',true,!ready(current)||Boolean(pending)||future)+button('custom','Other amount',' data-person="'+person+'" data-date="'+date+'"',false,Boolean(pending)||future)+'</div></article>';
      }).join('')+'</div>';
    }
    function renderWater() {
      const current=snapshot();if(!ready(current))return '<section class="panel"><h2>Water for both people</h2><p>Sign in to record and share your household’s water counts.</p>'+button('signin','Open sign-in','',true)+'</section>';
      let html='<section class="water-section" id="water-section"><div class="water-heading"><div><p class="page-kicker">A little care, throughout the day</p><h2>Water for both people</h2></div><label class="water-field"><span>Wellness date</span><input type="date" data-wellness-field="selectedDate" value="'+selectedDate+'" min="1900-01-01" max="2200-12-31"'+(busy||pending?' disabled':'')+'></label></div>';
      if(selectedDate>dayKey(getNow()))html+='<p class="caption">Viewing a future day. Water can be recorded once you have actually drunk it.</p>';
      html+=renderWaterCards(current,selectedDate,false)+pendingPanel(current)+renderForm(current)+'<section class="panel"><h3>Water history · '+esc(dateLabel(selectedDate))+'</h3>';
      const entries=sharedRows(current,'hydrationEntries').filter(row=>!row.archived&&row.occurred_on===selectedDate).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
      html+=entries.length?'<ul class="water-history">'+entries.map(row=>'<li><div><strong>Person '+row.person_slot+' · '+fmt(row.amount_ml)+' mL</strong>'+(row.notes?'<p>'+esc(row.notes)+'</p>':'')+'</div>'+button('remove','Undo entry',' data-id="'+esc(row.id)+'"',false,Boolean(pending))+'</li>').join('')+'</ul>':'<p>No water entries saved for this date.</p>';
      const archived=sharedRows(current,'hydrationEntries').filter(row=>row.archived&&row.occurred_on===selectedDate);
      if(archived.length)html+='<details><summary>Archived water entries · '+archived.length+'</summary><ul class="water-history">'+archived.map(row=>'<li><div><strong>Person '+Number(row.person_slot)+' · '+fmt(row.amount_ml)+' mL</strong><p>Removed from daily totals.</p>'+(row.notes?'<p>'+esc(row.notes)+'</p>':'')+'</div></li>').join('')+'</ul></details>';
      return html+'</section></section>';
    }
    function nyParts(date) {
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
      return Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
    }
    function nyLocalDate(year,month,day,hour,minute,second) {
      const targetUtc=Date.UTC(year,month-1,day,hour,minute,second||0);
      let guess=targetUtc;
      for(let attempt=0;attempt<3;attempt++) {
        const p=nyParts(new Date(guess));
        const shownUtc=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
        guess += targetUtc-shownUtc;
      }
      return new Date(guess);
    }
    function trashReminderState(now) {
      now=now||getNow();
      const p=nyParts(now),weekday={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[p.weekday];
      const hour=Number(p.hour),year=Number(p.year),month=Number(p.month),day=Number(p.day);

      // Trash pickup is Monday and Thursday, with a 10:00 a.m. put-out deadline.
      // Always show the next upcoming deadline on Home.
      let daysUntilMonday=(1-weekday+7)%7;
      let daysUntilThursday=(4-weekday+7)%7;

      // If today's deadline already passed, use the next occurrence.
      if(weekday===1 && hour>=10) daysUntilMonday=7;
      if(weekday===4 && hour>=10) daysUntilThursday=7;

      const addDays=Math.min(daysUntilMonday,daysUntilThursday);
      const base=new Date(Date.UTC(year,month-1,day+addDays,12,0,0));
      const bp=nyParts(base);
      const deadline=nyLocalDate(Number(bp.year),Number(bp.month),Number(bp.day),10,0,0);
      const remaining=Math.max(0,deadline.getTime()-now.getTime());

      const deadlineParts=nyParts(deadline);
      const deadlineWeekday=deadlineParts.weekday==='Mon'?'Monday':'Thursday';
      const isPickupDay=addDays===0;
      const previousNight=(weekday===0&&deadlineParts.weekday==='Mon'&&hour>=18)||(weekday===3&&deadlineParts.weekday==='Thu'&&hour>=18);
      const urgent=isPickupDay&&remaining<=60*60*1000;
      const reminderWindow=previousNight||isPickupDay;

      let title='Next trash day · '+deadlineWeekday;
      let detail='Trash pickup is Monday and Thursday. Trash needs to be out before 10:00 a.m.';
      if(previousNight) {
        title='Trash day is tomorrow';
        detail='Put the trash out tonight or before 10:00 a.m. tomorrow.';
      } else if(isPickupDay) {
        title=urgent?'Trash man’s coming — almost 10 a.m.':'Trash day is today';
        detail=urgent?'Get the trash out now — the 10:00 a.m. deadline is close.':'Trash needs to be out before 10:00 a.m. today.';
      }

      return {
        deadline:deadline.toISOString(),
        remaining,
        urgent,
        reminderWindow,
        trashDay:isPickupDay,
        pickupDay:deadlineWeekday,
        title,
        detail
      };
    }
    function renderHome(context) {
      context=context||{};const current=snapshot(),today=dayKey(getNow());
      const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(getNow()));
      const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
      let html='<div class="bloom-dashboard"><section class="bloom-home-hero"><p class="page-kicker">Your day, in bloom</p><h1 id="home-dashboard-heading" tabindex="-1">'+greeting+' <span aria-hidden="true">'+(hour<18?'☀':'☾')+'</span></h1><p>'+esc(dateLabel(today))+'</p><p class="bloom-home-gentle">A little care. A little practice.<br>Room for the day you’re having.</p></section>';
      if(ready(current)) {
        html+='<section class="bloom-household-strip"><span aria-hidden="true">⌂</span><div><strong>'+esc(current.household.name||'Your household')+'</strong><small>'+(current.members||[]).length+' of 2 household members · shared Food, Money, Dog & Housework</small></div>'+button('household','Household')+'</section>';
        const trash=trashReminderState(getNow());
        if(trash)html+='<section class="bloom-trash-reminder'+(trash.urgent?' is-urgent':'')+'" data-trash-reminder data-trash-deadline="'+esc(trash.deadline)+'"><span class="bloom-trash-icon" aria-hidden="true">🗑️</span><div><p class="page-kicker">Trash reminder</p><strong data-trash-title>'+esc(trash.title)+'</strong><p>'+esc(trash.detail)+'</p></div><div class="bloom-trash-countdown"><span>Time left</span><strong data-trash-countdown aria-live="polite"></strong><small>Deadline · 10:00 a.m.</small></div></section>';
        const todaysMeals=sharedRows(current,'cookingPlans').filter(row=>row.status==='planned'&&row.cook_on===today).sort((a,b)=>String(a.meal_type||'').localeCompare(String(b.meal_type||'')));
        if(todaysMeals.length)html+='<section class="bloom-meal-reminder"><span class="bloom-card-icon" aria-hidden="true">🍽️</span><div><p class="page-kicker">Today’s planned meal'+(todaysMeals.length===1?'':'s')+'</p><strong>'+todaysMeals.map(row=>esc(row.recipe_name||'Planned meal')).join(' · ')+'</strong><p>'+todaysMeals.map(row=>esc((row.meal_type||'dinner').replace(/^./,c=>c.toUpperCase()))+' · '+fmt(row.servings)+' servings').join(' &nbsp; • &nbsp; ')+'</p></div>'+button('meal-plans','Open today’s menu','',true)+'</section>';
        const h=options.getHabitsSummary?options.getHabitsSummary(today):{},dog=options.getDogSummary?options.getDogSummary(today):{};
        const boost=boostSummary(current,today,1);
        html+='<div class="bloom-dashboard-grid"><article class="bloom-dashboard-card card-peach boost-quick-card"><div class="boost-card-top"><span class="bloom-card-icon" aria-hidden="true">🥤</span>'+button('boost-plus','+',' data-product="'+esc(boost.product&&boost.product.id||'')+'" aria-label="Add one Boost" title="Add one Boost"',true,!boost.product||boost.stock<1||current.offline)+'</div><p class="page-kicker">Person 1 · Boost</p><strong class="bloom-card-value">'+fmt(boost.servings)+' today</strong><p>'+boost.stock+' Boost'+(boost.stock===1?'':'s')+' left in inventory.</p></article>';
        if(context.personalAvailable)html+='<article class="bloom-dashboard-card card-lilac"><span class="bloom-card-icon" aria-hidden="true">☾</span><p class="page-kicker">Sleep &amp; Mood</p><strong class="bloom-card-value">'+esc(context.sleepText)+'</strong><p>'+Number(context.moodCount||0)+' hourly feelings · tracking day '+esc(context.today)+'</p><button type="button" class="button" data-page-action="open-day" data-date="'+esc(context.today)+'">Open Daily Log</button></article>';
        html+='<article class="bloom-dashboard-card card-sage"><span class="bloom-card-icon" aria-hidden="true">🌿</span><p class="page-kicker">Smoking Log · your account</p><strong class="bloom-card-value">'+(h.smokingDay?Number(h.smokingDay.joints)+' joints · '+Number(h.smokingDay.cigars)+' cigars':'Not logged today')+'</strong><p>Zero is a valid entry. Record your own patterns.</p>'+button('navigate','Open Smoking Log',' data-page="smoking"')+'</article>';
        html+='<article class="bloom-dashboard-card card-cream"><span class="bloom-card-icon" aria-hidden="true">🎹</span><p class="page-kicker">Skills in Bloom</p><strong class="bloom-card-value">'+Number(h.dueSkills||0)+' reviews due</strong><p>'+Number(h.practiceMinutes||0)+' practice minutes logged today.</p>'+button('navigate','Choose a skill',' data-page="skills"')+'</article>';
        html+='<article class="bloom-dashboard-card card-pink"><img class="bloom-dog-avatar" src="./icons/dog-companion.jpeg" alt="Your cartoon dachshund"/><p class="page-kicker">Dog care</p><strong class="bloom-card-value">'+Number(dog.dueCount||0)+' care tasks due</strong><p>'+esc(dog.dogName||'Your companion')+' · '+Number(dog.completedCount||0)+' completed today.</p>'+button('navigate','Open Dog',' data-page="dog"')+'</article>';
        html+='<article class="bloom-dashboard-card card-sage"><span class="bloom-card-icon" aria-hidden="true">🥣</span><p class="page-kicker">Food in Bloom</p><strong class="bloom-card-value">'+esc(context.grocerySummary&&context.grocerySummary.title||'Your kitchen')+'</strong><p>Food at home, grocery list, menu, recipes and cooking.</p>'+button('navigate','Open Food',' data-page="food"')+'</article></div>';
        const entries=sharedRows(current,'moneyEntries').filter(row=>!row.voided_at&&row.direction==='expense'&&String(row.occurred_on).startsWith(today.slice(0,7)));
        const spent=entries.reduce((sum,row)=>sum+Number(row.amount_cents||0),0),savings=h.smokingEstimate&&h.smokingEstimate.savingsCents;
        html+='<section class="bloom-money-card"><div><p class="page-kicker">Money in Bloom</p><h2>'+money(spent)+'</h2><p>Recorded spending this month</p></div><div class="bloom-estimate"><strong>'+(savings==null?h.smokingDay?'Set your smoking baseline & prices':'Log your smoking day':money(Math.abs(savings)))+'</strong><span>'+(savings==null?'to compare a saved day with your original plan.':savings>=0?'estimated smoking cost below your baseline today':'estimated smoking cost above your baseline today')+'</span><small>Estimates are separate from actual money entries.</small></div>'+button('navigate','Open money ledger',' data-page="money"')+'</section>';
      } else html+='<section class="panel"><h2>Your connected daily dashboard</h2><p>Open your household to see planned meals, dog care, practice reminders, and your saved money records.</p>'+button('signin','Open sign-in','',true)+'</section>';
      if(context.personalAvailable)html+='<div class="bloom-ideas-strip"><span aria-hidden="true">🌱</span><p><strong>'+Number(context.noteCount||0)+' saved ideas</strong><br>A place for thoughts you want to keep.</p><button type="button" class="button" data-page-action="navigate" data-page-target="ideas">Open notes</button></div>';
      return html+'</div>';
    }
    function handleClick(event) {
      const target=event.target&&event.target.closest&&event.target.closest('[data-wellness-action]');if(!target)return false;
      event.preventDefault&&event.preventDefault();const action=target.dataset.wellnessAction,current=snapshot();
      if(busy)return true;
      try {
        if(action==='signin'){navigate('grocery');return true;}
        if(action==='navigate'){navigate(target.dataset.page);return true;}
        if(action==='water-page'){navigate('wellness');return true;}
        if(action==='meal-plans'){if(options.openFoodPlans)options.openFoodPlans();else navigate('food');return true;}
        if(action==='household'){if(options.openHousehold)options.openHousehold();else navigate('grocery');return true;}
        if(action==='boost-plus'){
          if(!target.dataset.product)throw new Error('Add a saved Boost product to Food in Bloom first.');
          if(!options.quickConsumeBoost)throw new Error('Refresh Life in Bloom to load quick Boost logging.');
          busy=true;refresh('.boost-quick-card');
          promise=Promise.resolve(options.quickConsumeBoost(target.dataset.product,1,dayKey(getNow()))).then(result=>{
            notify('1 Boost logged. '+Number(result&&result.remaining||0)+' left in inventory.');
          }).catch(error=>notify(error.message||'That Boost could not be logged.',true)).finally(()=>{busy=false;refresh('.boost-quick-card');});
          return true;
        }
        if(action==='boost'){if(options.openFoodLog)options.openFoodLog(target.dataset.product,1);else navigate('wellness');return true;}
        if(action==='retry'){submitAttempt();return true;}
        if(action==='close'){if(pending)throw new Error('Confirm the pending save before closing it.');if(dirty()&&!confirm('Discard this water draft?'))return true;form=null;baseline=null;persist();refresh();return true;}
        if(action==='settings'||action==='custom'||action==='add') {
          const previousDate=selectedDate;
          if(target.dataset.date&&validDate(target.dataset.date))selectedDate=target.dataset.date;
          if(!begin(action==='settings'?'settings':'entry',Number(target.dataset.person))){selectedDate=previousDate;return true;}
          if(selectedDate!==previousDate)viewSerial++;
          if(action==='add'&&!current.offline){pending={action:'entry',payload:payload(),viewSerial};submitAttempt();}
          else {persist();refresh('#water-form-panel');}
          return true;
        }
        if(action==='remove') {
          if(pending)throw new Error('Confirm the pending change first.');const row=sharedRows(current,'hydrationEntries').find(r=>r.id===target.dataset.id&&!r.archived);
          if(!row)throw new Error('Refresh to find this water entry.');if(!confirm('Undo this '+cupLabel(row.amount_ml)+' water entry for Person '+row.person_slot+'?'))return true;
          pending={action:'archive',payload:{...clone(row),request_id:uuid()}};submitAttempt();return true;
        }
      }catch(error){notify(error.message,true);}return true;
    }
    function handleInput(event) {
      const target=event.target;if(!target||!target.dataset)return false;
      if(target.dataset.wellnessCups){
        snapshot();if(busy||pending)return true;const name=target.dataset.wellnessCups;
        if(form&&['container_ml','goal_ml','amount_ml'].includes(name)){
          if(target.value==='')form[name]='';
          else {const ml=mlFromCups(target.value);if(Number.isFinite(ml))form[name]=String(Math.round(ml*1000)/1000);}
          persist();
        }
        return true;
      }
      if(!target.dataset.wellnessField)return false;
      const name=target.dataset.wellnessField;snapshot();if(busy||pending)return true;
      if(name==='selectedDate'){if(validDate(target.value)&&target.value!==selectedDate){if(dirty()&&!confirm('Keep the water draft on its original date and view another day?')){target.value=selectedDate;return true;}selectedDate=target.value;viewSerial++;persist();if(options.onDateChange)options.onDateChange(selectedDate);refresh();}return true;}
      if(form&&['container_ml','goal_ml','occurred_on','amount_ml','notes'].includes(name)){form[name]=String(target.value);persist();}return true;
    }
    function handleSubmit(event) {
      const target=event.target;if(!target||!target.dataset||target.dataset.wellnessForm!=='water')return false;
      event.preventDefault&&event.preventDefault();snapshot();if(busy)return true;
      try {if(!pending){for(const name of ['container_ml','goal_ml','occurred_on','amount_ml','notes']){const element=target.elements&&target.elements.namedItem&&target.elements.namedItem(name);if(element&&form&&Object.hasOwn(form,name))form[name]=String(element.value);}pending={action:form.type,payload:payload(),viewSerial};persist();}submitAttempt();}catch(error){notify(error.message,true);}return true;
    }
    function setSelectedDate(date){snapshot();if(!validDate(date))return false;if(date===selectedDate)return true;selectedDate=date;viewSerial++;persist();return true;}
    return {renderHome,renderWater,handleClick,handleInput,handleChange:handleInput,handleSubmit,isBusy:()=>busy,whenIdle:()=>promise,
      hasUnsavedDraft:()=>{snapshot();return Boolean(dirty()||pending||busy);},hasUnpersistedChanges:()=>{snapshot();return Boolean((dirty()||pending)&&!saved);},
      getSelectedDate:()=>{snapshot();return selectedDate;},setSelectedDate,trashReminderState,getHomeSummary:date=>{const c=snapshot(),day=validDate(date)?date:dayKey(getNow());return [1,2].map(person=>waterSummary(c,day,person));}};
  }
  const api={createController,waterSummary,boostSummary,dayKey,validDate};if(typeof module==='object'&&module.exports)module.exports=api;root.BloomWellness=api;
})(typeof window!=='undefined'?window:globalThis);
