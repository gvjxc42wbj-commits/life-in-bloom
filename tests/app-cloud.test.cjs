// Event/render smoke checks with a lightweight DOM stub. This is NOT a visual browser test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const root = require('node:path').resolve(__dirname, '..');
const html = fs.readFileSync(root + '/index.html', 'utf8');
const source = fs.readFileSync(root + '/app.js', 'utf8');
const dataSource = fs.readFileSync(root + '/bloom-data.js', 'utf8');
const insightsSource = fs.readFileSync(root + '/bloom-insights.js', 'utf8');
const appointmentsSource = fs.readFileSync(root + '/bloom-appointments.js', 'utf8');
const pagesSource = fs.readFileSync(root + '/bloom-pages.js', 'utf8');
const personalSource = fs.readFileSync(root + '/bloom-personal.js', 'utf8');
const grocerySource = fs.readFileSync(root + '/bloom-grocery.js', 'utf8');
const foodSources = ['bloom-drafts.js','bloom-food-model.js','bloom-commerce.js','bloom-food.js'].map(name => ({ name, source:fs.readFileSync(root + '/' + name,'utf8') }));
function createRuntime(seed = {}, failWrites = false, options = {}) {
  const elements = new Map();
  const downloads = [];
  const frames = [];
  const backing = new Map(Object.entries(seed));
  const classList = () => ({ toggle() {}, add() {}, remove() {} });
  const make = (id = '') => ({
    id, dataset: {}, classList: classList(), listeners: {}, hidden: false, value: '', innerHTML: '', textContent: '', disabled: false,
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    attributes: {}, setAttribute(name,value) { this.attributes[name]=value; }, removeAttribute(name) { delete this.attributes[name]; }, focus() { document.activeElement=this; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    contains(element) { return element === this || element?.parentNode === this; },
    insertAdjacentHTML(where, value) { this.innerHTML = where === 'afterbegin' ? value + this.innerHTML : this.innerHTML + value; },
    showModal() { this.open = true; }, close() { this.open = false; for (const fn of this.listeners.close || []) fn(); },
    remove() {}, click() { if (this.download) downloads.push(this); },
    async fire(type, target) { for (const fn of this.listeners[type] || []) await fn({ target: target || this, preventDefault() {} }); }
  });
  for (const id of ['content', 'notice', 'import-file', 'help-btn', 'help-dialog', 'close-help', 'got-it-btn', 'export-btn', 'menu-btn', 'app-menu', 'close-menu-btn', 'open-sleep-mood', 'menu-help-btn', 'menu-export-btn', 'page-heading', 'page-subtitle', 'sleep-mood-tabs', 'home-brand', 'bottom-nav']) {
    assert.ok(html.includes(`id="${id}"`), `Required shell element ${id}`);
    elements.set('#' + id, make(id));
  }
  for (const id of ['range-start', 'range-end', 'custom-activity-name', 'activity-error', 'mood-feeling', 'mood-note', 'mood-error']) elements.set('#' + id, make(id));
  const tabs = ['week', 'circle', 'day'].map(view => { const tab = make(); tab.dataset.view = view; return tab; });
  const navs = ['home','wellness','grocery','dog','money','sleep-mood','money','food','skills','ideas','housework','dog','smoking'].map(page => { const button=page==='sleep-mood' ? elements.get('#open-sleep-mood') : make(); button.dataset.page=page; return button; });
  const windowEvents = {};
  const confirmations = [];
  let confirmAnswer = true;
  const document = {
    activeElement: null,
    querySelector: selector => elements.get(selector) || null,
    querySelectorAll: selector => selector === '.view-tab' ? tabs : selector === '[data-page]' ? navs : [],
    getElementById: id => elements.get('#' + id) || null,
    createElement: () => make(),
    body: { appendChild(element) { if (element.id) elements.set('#' + element.id, element); } }
  };
  // Model the browser behavior that matters for live search: replacing innerHTML
  // removes focus and creates a different input with a new, initially zero caret.
  const content = elements.get('#content');
  let contentHtml = '';
  Object.defineProperty(content, 'innerHTML', {
    get() { return contentHtml; },
    set(value) {
      if (document.activeElement?.parentNode === content) document.activeElement = document.body;
      elements.delete('#commerce-search');
      contentHtml = value;
      const search = /<input\b[^>]*id="commerce-search"[^>]*>/.exec(value);
      if (search) {
        const field = make('commerce-search');
        field.parentNode = content; field.type = 'search'; field.dataset.commerceSearch = '';
        field.value = (/\bvalue="([^"]*)"/.exec(search[0])?.[1] || '').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
        field.selectionStart = field.selectionEnd = 0; field.selectionDirection = 'none';
        field.setSelectionRange = function(start, end, direction = 'none') {
          this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
        };
        elements.set('#commerce-search',field);
      }
    }
  });
  content.querySelector = selector => { const field = elements.get(selector); return field?.parentNode === content ? field : null; };
  const localStorage = {
    getItem: key => backing.has(key) ? backing.get(key) : null,
    setItem(key, value) { if (failWrites) throw new Error('quota'); backing.set(key, value); }, removeItem(key) { backing.delete(key); }
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-04T18:00:00Z'])); }
    static now() { return new Date('2026-11-04T18:00:00Z').getTime(); }
  }
  const window = { localStorage, scrollY: 0, scrollTo() {}, document, confirm: message => { confirmations.push(message); return confirmAnswer; }, addEventListener(type,fn) { windowEvents[type]=fn; } };
  const blobs = [];
  const context = vm.createContext({ window, document, Date: FixedDate, console, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    navigator: {}, location: { protocol: 'http:', hostname: '127.0.0.1' }, requestAnimationFrame: fn => options.deferFrames ? frames.push(fn) : fn(), setTimeout() {} });
  vm.runInContext(dataSource, context, { filename: 'bloom-data.js' });
  vm.runInContext(insightsSource, context, { filename: 'bloom-insights.js' });
  vm.runInContext(appointmentsSource, context, { filename: 'bloom-appointments.js' });
  vm.runInContext(pagesSource, context, { filename: 'bloom-pages.js' });
  vm.runInContext(personalSource, context, { filename: 'bloom-personal.js' });
  for(const item of foodSources) vm.runInContext(item.source, context, { filename:item.name });
  vm.runInContext(grocerySource, context, { filename: 'bloom-grocery.js' });
  let onChange;
  let cloudSnapshot = {status:'signed-out',user:null,household:null,members:[],privateProfile:null,dietProfiles:[],budgets:[],inventory:[],shoppingItems:[]};
  const cloud = {
    snapshot: () => cloudSnapshot,
    init: async () => {},
    refresh: async () => {},
    set(next) { cloudSnapshot = {...cloudSnapshot,...next}; if(onChange) onChange(); },
    signOut: async () => { cloud.set({status:'signed-out',user:null,household:null,shoppingItems:[]}); }
  };
  window.BloomGroceryStore = {createStore(options) {onChange=options.onChange;return cloud;}};
  vm.runInContext(source, context, { filename: 'app.js' });
  const target = dataset => ({ dataset, closest(selector) {
    const attribute = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!attribute) return null;
    const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return Object.hasOwn(dataset, key) ? this : null;
  } });
  return { cloud, elements, backing, tabs, navs, windowEvents, confirmations, document, flushFrames() { while(frames.length) frames.shift()(); }, confirm(value) {confirmAnswer=value;}, navigate: async page => navs.find(button=>button.dataset.page===page).fire('click'), D: window.BloomData, downloads, blobs,
    get: id => elements.get('#' + id),
    click: (id, dataset) => elements.get('#' + id).fire('click', target(dataset)),
    saved: () => JSON.parse(backing.get(window.BloomData.STORAGE_KEY)) };
}


const userA = {id:'11111111-1111-4111-8111-111111111111',email:'a@example.invalid'};
const userB = {id:'22222222-2222-4222-8222-222222222222',email:'b@example.invalid'};
function legacySeed() {
  const D=require('../bloom-data.js');
  return {[D.STORAGE_KEY]:JSON.stringify(D.normalizeData({
    records:{'2026-11-04':{notes:'Private original journal',slots:{0:'sleep'}}},
    shoppingList:[{id:'eggs',name:'Eggs',quantity:'6',checked:false}],
    ideaNotes:[{id:'private-idea',title:'Secret garden idea',body:'Private note'}]
  }))};
}

test('app routes Grocery to real account UI and retains legacy sleep controls before account setup', async()=>{
  const rt=createRuntime(legacySeed());
  await rt.navigate('grocery');
  assert.match(rt.get('content').innerHTML,/Sign in to your household/);
  assert.doesNotMatch(rt.get('content').innerHTML,/data-bloom-form="shopping"/);
  await rt.navigate('sleep-mood');
  await rt.tabs.find(x=>x.dataset.view==='day').fire('click');
  assert.equal((rt.get('content').innerHTML.match(/data-slot=/g)||[]).length,48);
  await rt.click('content',{slot:'1'});
  assert.equal(rt.saved().records['2026-11-04'].slots['1'],'sleep');
});

test('app gates existing private pages on first sign-in and requires explicit local ownership', async()=>{
  const rt=createRuntime(legacySeed());
  const original=rt.backing.get(rt.D.STORAGE_KEY);
  rt.cloud.set({status:'no-household',user:userA});
  await rt.navigate('ideas');
  assert.match(rt.get('content').innerHTML,/Are these earlier entries yours/);
  assert.doesNotMatch(rt.get('content').innerHTML,/Secret garden idea|Private note/);
  assert.equal(rt.get('export-btn').disabled,true);
  await rt.click('content',{personalAction:'claim'});
  assert.match(rt.get('content').innerHTML,/Secret garden idea/);
  assert.equal(rt.get('export-btn').disabled,false);
  assert.equal(rt.backing.get(rt.D.STORAGE_KEY),original);
  assert.equal(rt.cloud.snapshot().shoppingItems.length,0);
  await rt.get('export-btn').fire('click');
  const backup=JSON.parse(await rt.blobs.at(-1).text());
  assert.equal(backup.ideaNotes[0].title,'Secret garden idea');
});

test('account switch and signout clear visible personal records and shared Home counts', async()=>{
  const rt=createRuntime(legacySeed());
  rt.cloud.set({status:'no-household',user:userA});
  await rt.click('content',{personalAction:'claim'});
  rt.cloud.set({status:'ready',household:{id:'h-a',name:'First household'},members:[{user_id:userA.id,role:'owner'}],shoppingItems:[{id:'cloud-1',name:'Milk',checked:false}]});
  await rt.navigate('home');
  assert.match(rt.get('content').innerHTML,/1 item/);
  rt.cloud.set({status:'no-household',user:userB,household:null,members:[],shoppingItems:[]});
  await rt.navigate('ideas');
  assert.doesNotMatch(rt.get('content').innerHTML,/Secret garden idea|Private note/);
  assert.match(rt.get('content').innerHTML,/No notes saved yet/);
  rt.cloud.set({status:'signed-out',user:null,household:null});
  await rt.navigate('home');
  assert.match(rt.get('content').innerHTML,/Sign in/);
  assert.doesNotMatch(rt.get('content').innerHTML,/0\.5 hrs logged asleep|1 saved note|Coming up/);
  assert.equal(rt.get('export-btn').disabled,true);
  await rt.navigate('sleep-mood');
  assert.equal(rt.get('sleep-mood-tabs').hidden,true);
  assert.doesNotMatch(rt.get('content').innerHTML,/Your monthly moon wheel/);
});

test('an account changing during asynchronous personal import cannot replace the new account journal', async()=>{
  const rt=createRuntime(legacySeed());
  rt.cloud.set({status:'no-household',user:userA});
  await rt.click('content',{personalAction:'claim'});
  let finish;
  const text=new Promise(resolve=>finish=resolve);
  const importing=rt.get('import-file').fire('change',{files:[{size:100,text:()=>text}],value:''});
  rt.cloud.set({status:'no-household',user:userB,household:null});
  finish(JSON.stringify(rt.D.makeBackup(rt.D.normalizeData({records:{'2026-11-01':{notes:'WRONG ACCOUNT IMPORT'}}}))));
  await importing;
  assert.match(rt.get('notice').textContent,/account changed/);
  const target='life-in-bloom.personal.'+userB.id+'.'+rt.D.STORAGE_KEY;
  assert.equal(rt.backing.get(target),undefined);
});

test('Food, Wellness and Money routes open their connected household screens and use-soon deep link', async()=>{
  const rt=createRuntime();
  rt.cloud.set({status:'ready',user:userA,household:{id:'h-a',name:'Household',owner_user_id:userA.id},members:[{user_id:userA.id,household_id:'h-a',role:'owner'}],
    products:[],recipes:[],mealEntries:[],receipts:[],moneyEntries:[],bills:[],foodFiles:[],recurringProducts:[]});
  await rt.navigate('food');
  assert.match(rt.get('content').innerHTML,/Saved recipes/);
  await rt.navigate('wellness');
  assert.match(rt.get('content').innerHTML,/Person 1/);
  assert.match(rt.get('content').innerHTML,/Person 2/);
  await rt.navigate('money');
  assert.match(rt.get('content').innerHTML,/Your monthly money ledger/);
  await rt.navigate('grocery');
  await rt.click('content',{groceryAction:'use-soon'});
  assert.match(rt.get('content').innerHTML,/Use soon/);
  assert.match(rt.get('content').innerHTML,/data-food-action="tab" data-tab="soon" aria-current="page"/);
});

test('offline shared routes show a dated saved-copy notice without changing personal logs', async()=>{
  const rt=createRuntime();
  rt.cloud.set({status:'ready',user:userA,household:{id:'h-a',name:'Household',owner_user_id:userA.id},members:[{user_id:userA.id,household_id:'h-a',role:'owner'}],
    offline:true,cachedAt:'2026-11-04T12:00:00Z',products:[],recipes:[],mealEntries:[],receipts:[],moneyEntries:[],bills:[],foodFiles:[],recurringProducts:[]});
  for(const page of ['food','wellness','money','grocery']) {
    await rt.navigate(page);
    assert.match(rt.get('content').innerHTML,/Offline — showing your saved device copy/);
  }
});

async function openSearch() {
  const rt=createRuntime({},false,{deferFrames:true});
  rt.cloud.set({status:'ready',user:userA,household:{id:'h-a',name:'Household',owner_user_id:userA.id},members:[{user_id:userA.id,household_id:'h-a',role:'owner'}],
    products:[{id:'product-one',name:'Meat',brand:'',store:'',category:'food',aisle:'meat',package_quantity:1,package_unit:'each',price_cents:null}],
    recipes:[],mealEntries:[],receipts:[],moneyEntries:[],bills:[],foodFiles:[],recurringProducts:[]});
  await rt.navigate('grocery'); await rt.click('content',{groceryAction:'tab',tab:'catalog'}); rt.flushFrames();
  rt.get('commerce-search').focus();
  rt.insertText=async text=>{
    const field=rt.get('commerce-search');
    assert.equal(rt.document.activeElement,field,'the search must keep focus before the next frame');
    const position=field.selectionStart;
    field.value=field.value.slice(0,position)+text+field.value.slice(field.selectionEnd);
    field.setSelectionRange(position+text.length,position+text.length);
    await rt.get('content').fire('input',field);
    return rt.get('commerce-search');
  };
  return rt;
}

test('catalog search keeps rapid typing, middle edits and selection replacement in order before animation frames', async()=>{
  const rt=await openSearch();
  for(const letter of 'Meat') await rt.insertText(letter);
  assert.equal(rt.get('commerce-search').value,'Meat');
  assert.equal(rt.get('commerce-search').selectionStart,4);
  assert.match(rt.get('content').innerHTML,/1 matching product/);
  rt.get('commerce-search').setSelectionRange(2,2);
  await rt.insertText('X');
  assert.equal(rt.get('commerce-search').value,'MeXat');
  assert.equal(rt.get('commerce-search').selectionStart,3);
  rt.get('commerce-search').setSelectionRange(2,3,'backward');
  await rt.insertText('');
  assert.equal(rt.get('commerce-search').value,'Meat');
  rt.get('commerce-search').setSelectionRange(0,4);
  await rt.insertText('Rice');
  assert.equal(rt.get('commerce-search').value,'Rice');
  assert.equal(rt.get('commerce-search').selectionStart,4);
  rt.get('page-heading').focus(); rt.flushFrames();
  assert.equal(rt.document.activeElement,rt.get('page-heading'),'old frames must not steal focus back');
});

test('background refresh preserves the active search selection instead of dropping its focus', async()=>{
  const rt=await openSearch();
  await rt.insertText('Meat');
  rt.get('commerce-search').setSelectionRange(1,3,'backward');
  rt.cloud.set({});
  assert.equal(rt.document.activeElement,rt.get('commerce-search'));
  assert.equal(rt.get('commerce-search').value,'Meat');
  assert.equal(rt.get('commerce-search').selectionStart,1);
  assert.equal(rt.get('commerce-search').selectionEnd,3);
  assert.equal(rt.get('commerce-search').selectionDirection,'backward');
  await rt.insertText('oo');
  assert.equal(rt.get('commerce-search').value,'Moot');
});
