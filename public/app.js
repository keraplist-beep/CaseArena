const $=s=>document.querySelector(s);
let me=null, inventory=[], selected=new Set(), skins=[], casesCache=[], upgradeSourceId=null, upgradeSourceIds=[], upgradeTarget=null, rolling=false, skinCatalogVisible=72;
const UPGRADE_DEFAULTS={chance:35,speed:8,shape:"arrow",wheelDesign:"v2",pointerType:"gold",spinType:"normal",sound:true,quickMultipliers:[2,5,10],quickChances:[35,50,75]};
let upgradeSettings=(()=>{try{const v=JSON.parse(localStorage.getItem("casearena-upgrade-settings")||"{}");const arr=(x,d,min,max)=>Array.isArray(x)&&x.length===3?x.map((n,i)=>Math.max(min,Math.min(max,Number(n)||d[i]))):d.slice();return {...UPGRADE_DEFAULTS,...v,speed:v.speed==="fast"||Number(v.speed)===2?2:8,wheelDesign:v.wheelDesign==="v1"?"v1":"v2",pointerType:["gold","red","orange","green","lime"].includes(v.pointerType)?v.pointerType:"gold",spinType:v.spinType===" азарт"?" азарт":"normal",sound:v.sound!==false,quickMultipliers:arr(v.quickMultipliers,[2,5,10],1,100),quickChances:arr(v.quickChances,[35,50,75],1,95)}}catch{return {...UPGRADE_DEFAULTS}}})();
function saveUpgradeSettings(){try{localStorage.setItem("casearena-upgrade-settings",JSON.stringify(upgradeSettings))}catch{}}
function applyUpgradeWheelSettings(){const p=$("#upgrade-wheel-pointer"),d=$("#upgrade-wheel-dial"),s=$(".upgrade-reference");if(p)p.dataset.shape=upgradeSettings.pointerType;if(d)d.dataset.design=upgradeSettings.wheelDesign;if(s){s.dataset.spin=upgradeSettings.spinType;s.dataset.sound=upgradeSettings.sound?"on":"off"}document.querySelectorAll("[data-upgrade-mult]").forEach((e,i)=>{e.textContent="X"+upgradeSettings.quickMultipliers[i];e.onclick=()=>setUpgradeMultiplier(upgradeSettings.quickMultipliers[i])});document.querySelectorAll("[data-upgrade-odds]").forEach((e,i)=>{e.textContent=upgradeSettings.quickChances[i]+"%";e.onclick=()=>setUpgradeOdds(upgradeSettings.quickChances[i])})}
window.setUpgradeSetting=(k,v)=>{if(k==="speed")upgradeSettings.speed=v==="fast"?2:8;if(k==="wheelDesign")upgradeSettings.wheelDesign=v==="v1"?"v1":"v2";if(k==="pointerType"&&["gold","red","orange","green","lime"].includes(v))upgradeSettings.pointerType=v;if(k==="spinType")upgradeSettings.spinType=v===" азарт"?" азарт":"normal";if(k==="sound")upgradeSettings.sound=v===true||v==="true"||v==="on";saveUpgradeSettings();applyUpgradeWheelSettings();updateUpgradePreview();};
window.saveUpgradeCustomButtons=()=>{const m=[0,1,2].map(i=>Number($("#upgrade-mult-"+i)?.value)||[2,5,10][i]),o=[0,1,2].map(i=>Number($("#upgrade-odds-"+i)?.value)||[35,50,75][i]);if(m.some(x=>x<1||x>100)||o.some(x=>x<1||x>95))return toast("Множитель: 1–100, шанс: 1–95%");upgradeSettings.quickMultipliers=m;upgradeSettings.quickChances=o;saveUpgradeSettings();applyUpgradeWheelSettings();closeModal();toast("Настройки сохранены")};
window.openUpgradeSettings=()=>{const radio=(k,v,t,d)=>'<label class="upgrade-setting-radio"><input type="radio" name="setting-'+k+'" '+(upgradeSettings[k]===v?"checked":"")+' onchange="setUpgradeSetting(\''+k+'\',\''+v+'\')"><span><b>'+t+'</b>'+(d?'<small>'+d+'</small>':'')+'</span></label>';const ptr=v=>'<label class="upgrade-pointer-choice"><span class="upgrade-pointer-icon pointer-'+v+'"></span><input type="radio" name="setting-pointer" '+(upgradeSettings.pointerType===v?"checked":"")+' onchange="setUpgradeSetting(\'pointerType\',\''+v+'\')"></label>';const html='<div class="upgrade-settings-v2"><section><h3>Дизайн "круга" с шансами</h3><p>Вы можете выбрать различный дизайн для центрального круга с шансами:</p>'+radio("wheelDesign","v1","v.1 Старый дизайн","Наша изначальная версия круга с шансами.")+radio("wheelDesign","v2","v.2 Новый дизайн","Новое исполнение в виде бублика.")+'</section><section><h3>Тип стрелки</h3><p>Вы можете выбрать внешний вид вращающейся стрелки:</p><div class="upgrade-pointer-list">'+["gold","red","orange","green","lime"].map(ptr).join("")+'</div></section><section><h3>Быстрый подбор <a href="#" onclick="event.preventDefault();upgradeSettings.quickMultipliers=[2,5,10];upgradeSettings.quickChances=[35,50,75];openUpgradeSettings()">(восстановить)</a></h3><p>Настройте кнопки для быстрого подбора по коэффициенту:</p><div class="upgrade-custom-grid">'+[0,1,2].map(i=>'<label>X <input id="upgrade-mult-'+i+'" type="number" min="1" max="100" value="'+upgradeSettings.quickMultipliers[i]+'"></label>').join("")+'</div><p>Настройте кнопки для быстрого подбора по проценту:</p><div class="upgrade-custom-grid">'+[0,1,2].map(i=>'<label><input id="upgrade-odds-'+i+'" type="number" min="1" max="95" value="'+upgradeSettings.quickChances[i]+'"> %</label>').join("")+'</div></section><section><h3>Тип прокрутки</h3><p>Вы можете выбрать различную анимацию вращения стрелки вокруг "колеса" шансов:</p><p class="upgrade-setting-note">Выбор версии никак не повлияет на шанс. Это просто настройка анимации и всё.</p>'+radio("spinType","normal","v.1 Обычная","Наша изначальная прокрутка.")+radio("spinType"," азарт","v.2 Азартная","Более длительная и непредсказуемая анимация.")+'</section><section><h3>Скорость анимации</h3><div class="upgrade-speed-options"><button type="button" class="'+(upgradeSettings.speed===8?"active":"")+'" onclick="setUpgradeSetting(\'speed\',\'slow\')">Медленно <small>8 сек</small></button><button type="button" class="'+(upgradeSettings.speed===2?"active":"")+'" onclick="setUpgradeSetting(\'speed\',\'fast\')">Быстро <small>2 сек</small></button></div></section><section><h3>Звук в апгрейде</h3><p>Вы можете включить или отключить звуковое сопровождение в этом режиме:</p>'+radio("sound",true,"Включен","Звуковые эффекты включены.")+radio("sound",false,"Выключен","Звуковые эффекты отключены.")+'</section><button class="btn primary full-btn upgrade-settings-save" onclick="saveUpgradeCustomButtons()">СОХРАНИТЬ И ЗАКРЫТЬ ОКНО</button></div>';openModal("НАСТРОЙКИ",html);applyUpgradeWheelSettings()};

const money=n=>Number(n||0).toLocaleString("ru-RU")+" CR";
const rub=n=>Number(n||0).toLocaleString("ru-RU")+" ₽";
const usd=n=>"$"+Number(n||0).toFixed(2);
const ROLE_ORDER=["user","moderator","admin","senior_admin","deputy_head_admin","head_admin","co_owner","owner"];
const ROLE_LABELS={user:"Игрок",moderator:"Модератор",admin:"Администратор",senior_admin:"Старший администратор",deputy_head_admin:"ЗГА",head_admin:"Главный администратор",co_owner:"Dep.Owner",owner:"Владелец"};
const roleRank=role=>{const n=ROLE_ORDER.indexOf(role);return n<0?0:n};
const roleBadge=role=>role&&role!=="user"?'<span class="role-tag role-tag-'+role+'">'+(role==="deputy_head_admin"?"ЗГА":role==="head_admin"?"ГА":role==="senior_admin"?"СТАРШИЙ АДМИН":role==="moderator"?"МОДЕРАТОР":role==="admin"?"АДМИН":role==="co_owner"?"DEP.OWNER":"OWNER")+'</span>':"";
const api=async(url,opts={})=>{const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||"Ошибка запроса");return d};
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function toast(t){const el=$("#toast");el.textContent=t;el.style.display="block";clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.style.display="none",3000)}
function openModal(title,html){$("#modal-title").textContent=title;$("#modal-body").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
window.closeModal=closeModal;
function authModal(){openModal("Вход в CaseArena",'<a class="btn secondary google-btn" href="/auth/google"><b>G</b> Продолжить с Google</a><p id="google-auth-status" class="muted small">Проверяем подключение Google…</p><p class="muted small">Или войди по игровому нику.</p><div class="inline"><button class="btn secondary" onclick="authForm(\'login\')">Войти</button><button class="btn secondary" onclick="authForm(\'register\')">Регистрация</button></div><div id="auth-form"></div>');authForm("login");checkGoogleAuthStatus()}
async function checkGoogleAuthStatus(){const status=$("#google-auth-status"),button=document.querySelector(".google-btn");if(!status||!button)return;if(!button.dataset.guard){button.dataset.guard="1";button.addEventListener("click",e=>{if(button.getAttribute("aria-disabled")==="true"){e.preventDefault();toast("Вход через Google пока не настроен на сервере")}})}try{const result=await api("/api/google/status");if(!result.configured){button.setAttribute("aria-disabled","true");button.style.opacity=".55";button.style.cursor="not-allowed";status.textContent="Вход через Google пока не включён на сервере. Нужны настройки Google OAuth.";status.style.color="#e7b96b"}else{button.removeAttribute("aria-disabled");button.style.opacity="1";button.style.cursor="pointer";status.textContent="Google авторизация подключена.";status.style.color="#65d6a3"}}catch(error){button.setAttribute("aria-disabled","true");status.textContent="Не удалось проверить подключение Google. Попробуй позже."}}
window.authModal=authModal;
window.authForm=mode=>{$("#auth-form").innerHTML='<form onsubmit="submitAuth(event,\''+mode+'\')"><input name="username" placeholder="Никнейм" minlength="3" maxlength="20" required><input name="password" type="password" '+(mode==="register"?'placeholder="Пароль (минимум 10 символов)" minlength="10"':'placeholder="Пароль"')+' required><button class="btn primary">'+(mode==="login"?"Войти":"Создать аккаунт")+'</button></form>'};
window.submitAuth=async(e,mode)=>{e.preventDefault();const f=new FormData(e.target);try{await api("/api/"+(mode==="login"?"login":"register"),{method:"POST",body:JSON.stringify(Object.fromEntries(f))});closeModal();await refresh();toast("Добро пожаловать в CaseArena")}catch(err){toast(err.message)}};
function nicknameModal(){openModal("Выбери игровой ник",'<p class="muted">Google подключён. Придумай ник для профиля.</p><form onsubmit="completeGoogleNick(event)"><input name="username" placeholder="Например, DragonKing" minlength="3" maxlength="20" required><button class="btn primary">Продолжить</button></form>')}
window.completeGoogleNick=async e=>{e.preventDefault();const username=new FormData(e.target).get("username");try{await api("/api/google/complete-nickname",{method:"POST",body:JSON.stringify({username})});closeModal();history.replaceState({},"",location.pathname);await refresh()}catch(err){toast(err.message)}};
function renderAccount(){const a=$("#account");if(!a)return;a.innerHTML=me?'<button class="profile-shortcut" onclick="goProfile()"><span class="mini-avatar">'+esc(me.username.slice(0,1).toUpperCase())+'</span><span class="account-name">'+esc(me.username)+roleBadge(me.role)+'<small>'+money(me.balance)+'</small></span></button><button class="btn secondary" onclick="logout()">Выйти</button>':'<button class="btn secondary" onclick="authModal()">Войти</button><button class="btn primary" onclick="authModal()">Регистрация</button>'}
window.canAccessOwner=()=>!!me&&["owner","co_owner"].includes(me.role);
window.canAccessStaff=()=>!!me&&roleRank(me.role)>=1;
window.ownerAccessReady=false;
window.updateOwnerNavigation=()=>{
 const nav=document.querySelector(".bottom-nav");if(!nav)return;
 let owner=nav.querySelector('[data-nav="owner"]'),staff=nav.querySelector('[data-nav="staff"]');
 if(window.canAccessOwner()&&!owner){owner=document.createElement("a");owner.href="#owner";owner.dataset.nav="owner";owner.innerHTML='<span class="bottom-nav-icon">🛡</span><span></span>';nav.appendChild(owner)}if(owner)owner.querySelector("span:last-child").textContent=me?.role==="co_owner"?"Dep.Owner":"Владелец"
 if(!window.canAccessOwner()&&owner)owner.remove();
 if(me&&roleRank(me.role)>=1&&!staff){staff=document.createElement("a");staff.href="#staff";staff.dataset.nav="staff";staff.innerHTML='<span class="bottom-nav-icon">🛠</span><span>Персонал</span>';nav.appendChild(staff)}
 if((!me||roleRank(me.role)<1)&&staff)staff.remove();
 nav.classList.toggle("owner-mode",window.canAccessOwner());window.renderCaseArenaPage?.(location.hash||"cases");
};
window.goProfile=()=>{location.hash="profile"};
window.logout=async()=>{try{await api("/api/logout",{method:"POST"});me=null;inventory=[];upgradeSourceIds=[];upgradeSourceId=null;selected.clear();renderAccount();renderProfile();renderUpgrade();window.updateOwnerNavigation?.();toast("Вы вышли из аккаунта")}catch(e){toast(e.message)}};
async function refresh(){try{const d=await api("/api/me");me=d.user;inventory=d.inventory||[];loadLeaders().catch(e=>console.warn("Leaderboard refresh failed:",e.message));upgradeSourceIds=upgradeSourceIds.filter(id=>inventory.some(x=>x.id===id));upgradeSourceId=upgradeSourceIds[0]??null;renderAccount();renderProfile();renderUpgrade();window.ownerAccessReady=true;window.updateOwnerNavigation?.();if(window.canAccessOwner())await loadOwner();else $("#owner-content").innerHTML="";if(me&&roleRank(me.role)>=1)await loadStaff();else $("#staff-content").innerHTML="";}catch(error){window.ownerAccessReady=true;window.updateOwnerNavigation?.();throw error;}}
function skinInfo(name){return skins.find(x=>x.name===name)||{name,value:0,steamRub:0,rarity:"Предмет",image:"",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)}}
function skinArt(name){const s=skinInfo(name);const glyph=name.startsWith("★")?"✦":name.split(" | ")[0].slice(0,3).toUpperCase();const image=s.image||"";return '<div class="skin-art '+(image?"":"no-image")+'">'+(image?'<img loading="lazy" src="'+esc(image)+'" alt="'+esc(name)+'" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-image\')">':'')+'<span class="skin-glyph">'+esc(glyph)+'</span></div>'}
function skinCard(name,value,opts={}){const s=skinInfo(name),itemType=skinCategory(s);return '<article data-rarity="'+esc(s.rarity||"")+'" data-item-type="'+esc(itemType)+'" class="skin-card rarity-'+esc((s.rarity||"").toLowerCase().replace(/[^a-zа-яё]+/g,"-"))+'">'+skinArt(name)+'<div class="skin-card-info"><span class="rarity-text">'+esc(s.rarity||"CS2")+'</span><b>'+esc(name)+'</b><strong>'+money(value??s.value)+'</strong><small class="steam-price">'+(Number(s.marketUsd)>0?usd(s.marketUsd)+" · "+(s.priceSource==="Steam Market"?"Steam":"рынок"):s.priceSource==="Оценка CaseArena"?"Оценка CR · нет котировки":"Оценка CR")+'</small>'+(opts.market?'<a class="market-link" href="'+esc(s.steamUrl)+'" target="_blank" rel="noopener">Steam Market ↗</a>':'')+(opts.buy?'<button class="btn primary skin-buy-btn" onclick="buySkin(&quot;'+esc(name)+'&quot;)">Купить за '+money(value??s.value)+'</button>':'')+(opts.select?'<label class="select-item"><input type="checkbox" '+(selected.has(opts.id)?"checked":"")+' onchange="toggleItem('+opts.id+',this.checked)"> Выбрать</label>':'')+(opts.sell?'<button class="btn secondary sell-skin-btn" onclick="sellItem('+opts.id+')">Продать за '+money(value??s.value)+'</button>':'')+'</div></article>'}
function skinCategory(s){return s.category||(s.name.startsWith("★")?(s.name.includes("Gloves")?"Перчатки":"Нож"):"Оружие")}
function renderSkinCatalog(reset=true){
 const grid=$("#skin-catalog-grid");if(!grid)return;
 if(reset)skinCatalogVisible=72;
 const query=String($("#skin-catalog-search")?.value||"").trim().toLowerCase();
 const category=$("#skin-catalog-category")?.value||"all";
 const filtered=skins.filter(s=>(!query||(s.name+" "+(s.rarity||"")).toLowerCase().includes(query))&&(category==="all"||skinCategory(s)===category));
 $("#skin-catalog-count").textContent="Найдено: "+filtered.length.toLocaleString("ru-RU")+" · всего в каталоге: "+skins.length.toLocaleString("ru-RU");
 grid.innerHTML=filtered.slice(0,skinCatalogVisible).map(s=>skinCard(s.name,s.value,{market:true,buy:true})).join("")||'<p class="muted">По запросу ничего не найдено.</p>';
 const more=$("#skin-catalog-more");if(more)more.style.display=filtered.length>skinCatalogVisible?"inline-flex":"none";
}
window.buySkin=async name=>{
 if(!me)return authModal();
 const skin=skins.find(item=>item.name===name);
 if(!skin)return toast("Скин не найден");
 if(!confirm("Купить "+skin.name+" за "+money(skin.value)+"?"))return;
 try{
  const d=await api("/api/skins/buy",{method:"POST",body:JSON.stringify({skinName:skin.name})});
  await refresh();renderSkinCatalog(false);
  toast("Куплено: "+d.name+" · −"+money(d.value));
 }catch(error){toast(error.message)}
};
window.filterSkinCatalog=()=>renderSkinCatalog(true);
window.showMoreSkins=()=>{skinCatalogVisible+=72;renderSkinCatalog(false)};
async function loadSkins(){skins=await api("/api/skins");renderSkinCatalog();renderUpgrade()}
/* ============================================================
   CASES GRID — интерфейс как CaseBattle
   ============================================================ */

async function loadTopDrops(){
 const host=$("#top-drops-grid");if(!host)return;
 try{
  const items=await api("/api/top-drops");
  host.innerHTML=items.map((item,index)=>'<article class="top-drop-card top-drop-'+index+'"><span class="top-drop-rank">TOP '+(index+1)+'</span><div class="top-drop-art">'+(item.image?'<img loading="lazy" src="'+esc(item.image)+'" alt="'+esc(item.name)+'">':skinArt(item.name))+'</div><div class="top-drop-info"><b>'+esc(item.name)+'</b><strong>'+money(item.value)+'</strong><small>'+esc(item.rarity||"CS2")+'</small></div>'+(item.caseId?'<button class="top-drop-action" onclick="showCase(\''+esc(item.caseId)+'\')">Как получить?</button>':'<button class="top-drop-action" onclick="navigateCaseArenaPage(\'skins\')">В каталоге скинов</button>')+'</article>').join("")||'<p class="muted">Топ дропов пока недоступен.</p>';
 }catch(error){host.innerHTML='<p class="muted">Не удалось загрузить топ дропов.</p>';console.warn(error)}
}
function initDemoLiveStats(){
 const online=$("#live-online"),opened=$("#live-opened");if(!online||!opened)return;
 let players=118+Math.floor(Math.random()*43),cases=780+Math.floor(Math.random()*470);
 const paint=()=>{online.textContent=players.toLocaleString("ru-RU");opened.textContent=cases.toLocaleString("ru-RU")};
 paint();setInterval(()=>{players=Math.max(70,Math.min(210,players+Math.floor(Math.random()*13)-6));cases=Math.max(400,cases+Math.floor(Math.random()*39)-12);paint()},10000);
}
let casesFilter = "all";
let casesSort   = "default";
let casesLimit  = 12;
let casesSearch = "";

function renderCases() {
  console.log("NEW renderCases called", casesCache.length);
  let list = [...casesCache];

  if (casesFilter === "budget") {
    list = list.filter(x => Number(x.price) <= 500);
  } else if (casesFilter === "premium") {
    list = list.filter(x => Number(x.price) >= 5000);
  } else if (casesFilter === "popular") {
    const popularIds = [
      "neon","royal","knife","elite","viper","dragon",
      "doppler","gloves","blackpearl"
    ];
    list = list.filter(x =>
      popularIds.includes(String(x.id)) ||
      x.tag === "popular" ||
      x.popular === true ||
      x.featured === true ||
      x.tag === "hot"
    );
  }

  if (casesSearch.trim()) {
    const q = casesSearch.trim().toLowerCase();
    list = list.filter(x => String(x.name || "").toLowerCase().includes(q));
  }

  if (casesSort === "price-asc") list.sort((a,b) => Number(a.price) - Number(b.price));
  if (casesSort === "price-desc") list.sort((a,b) => Number(b.price) - Number(a.price));

  const grid = document.querySelector("#case-grid");
  if (!grid) return;

  const visible = list.slice(0, casesLimit);

  grid.innerHTML = visible.map(item => {
    const price = Number(item.price) || 0;
    let badge = "";
    if (price >= 5000) badge = '<div class="ca-badge hot">TOP</div>';
    else if (price >= 500) badge = '<div class="ca-badge new">HOT</div>';

    const initial = esc(String(item.name || "?").trim().charAt(0).toUpperCase() || "?");
    const imageHTML = item.image
      ? '<img loading="lazy" src="' + esc(item.image) + '" alt="' + esc(item.name) + '" onerror="this.parentNode.innerHTML=\'<div class=&quot;ca-fallback&quot;>' + initial + '</div>\'">'
      : '<div class="ca-fallback">' + initial + '</div>';

    return '<article class="case-card ca-card" data-id="' + esc(item.id) + '">' +
      badge +
      '<div class="case-image ca-card-img">' + imageHTML + '</div>' +
      '<div class="case-info">' +
        '<div class="case-name ca-card-name">' + esc(item.name) + '</div>' +
        '<div class="case-meta ca-card-meta">' + Number(item.count || 0) + ' скинов</div>' +
        '<div class="case-price ca-card-price">' + money(price) + '</div>' +
      '</div>' +
      '<div class="case-card-actions"><button class="case-open-btn ca-card-btn" type="button" onclick="showCase(\'' + esc(item.id) + '\')">Открыть</button><button class="case-quick-btn" type="button" onclick="openCase(\'' + esc(item.id) + '\',true)">⚡ Быстрое открытие</button></div>' +
    '</article>';
  }).join("");

  if (!visible.length) {
    grid.innerHTML = '<div class="ca-empty">Ничего не найдено</div>';
  }

  const more = document.querySelector("#showMoreCases");
  if (more) {
    more.hidden = visible.length >= list.length;
    more.textContent = 'Показать ещё (' + Math.max(0, list.length - visible.length) + ')';
  }
}

window.showMoreCases = () => {
  casesLimit += 12;
  renderCases();
};

function bindCasesControls() {
  document.querySelectorAll("[data-cases-filter]").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("[data-cases-filter]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      casesFilter = btn.dataset.casesFilter;
      casesLimit = 12;
      renderCases();
    };
  });

  const sortSel = document.querySelector("[data-cases-sort]");
  if (sortSel) sortSel.onchange = e => {
    casesSort = e.target.value;
    casesLimit = 12;
    renderCases();
  };

  const searchInput = document.querySelector("[data-cases-search]");
  if (searchInput) searchInput.oninput = e => {
    casesSearch = e.target.value;
    casesLimit = 12;
    renderCases();
  };
}

async function loadCases() {
  casesCache = await api("/api/cases");
  casesLimit = 12;
  bindCasesControls();
  renderCases();
}

window.showCase=async id=>{
 try{
  const d=await api("/api/cases/"+id);
  const host=$("#case-detail-content");if(!host)throw new Error("Страница кейса не найдена");
  host.innerHTML='<div class="case-detail-page-head"><button class="btn secondary" onclick="navigateCaseArenaPage(\'cases\')">← Все кейсы</button><span class="eyebrow">CASEARENA / CASE DETAILS</span></div><div class="case-detail case-theme-'+esc(d.theme)+'"><div class="case-detail-hero"><div class="case-detail-art">'+esc(d.name)+'</div>'+(d.image?'<img src="'+esc(d.image)+'" alt="'+esc(d.name)+'">':'')+'<span>'+esc(d.subtitle)+'</span></div><div class="case-detail-heading"><div><h3>'+esc(d.name)+'</h3><p class="muted small">'+d.count+' предметов · средний дроп около '+money(d.expectedValue||0)+'</p></div><strong>'+money(d.price)+'</strong></div><div class="case-detail-items">'+d.items.map(item=>'<article class="case-drop-card"><div class="case-drop-image">'+(item.image?'<img src="'+esc(item.image)+'" alt="'+esc(item.name)+'">':'<span>CS2</span>')+'</div><b>'+esc(item.name)+'</b><small>'+money(item.value)+'</small><em>'+Number(item.chance).toLocaleString("ru-RU")+'%</em></article>').join("")+'</div><button class="btn primary full-btn" onclick="openCase(\''+esc(d.id)+'\')">Открыть за '+money(d.price)+'</button></div>';
  window.navigateCaseArenaPage?.("case-detail");
 }catch(e){toast(e.message)}
};

function makeRollItems(caseItems,winningDrop){
 const pool=Array.isArray(caseItems)&&caseItems.length?caseItems:[{name:"AK-47 | Redline",value:720,chance:1}];
 const total=pool.reduce((sum,item)=>sum+Math.max(0,Number(item.chance)||0),0)||pool.length;
 const draw=()=>{let roll=Math.random()*total;for(const item of pool){roll-=Math.max(0,Number(item.chance)||0);if(roll<=0)return item}return pool[pool.length-1]};
 const winner=pool.find(item=>item.name===winningDrop.name&&Number(item.value)===Number(winningDrop.value))||{name:winningDrop.name,value:Number(winningDrop.value)||0,chance:0};
 const stopIndex=52,arr=Array.from({length:64},draw);arr[stopIndex]=winner;return arr;
}
function rouletteMarkup(items){
 const stopIndex=52;
 return '<div class="opening-subtitle">ИЩЕМ ТВОЙ ПРЕДМЕТ В КЕЙСЕ</div><div class="roulette-shell casebattle-roulette"><div class="roulette-pointer"></div><div class="roulette-window" id="roulette-window"><div class="roulette-track" id="roulette-track">'+items.map((item,i)=>'<div class="roulette-skin '+(i===stopIndex?'roulette-winner':'')+'">'+skinArt(item.name)+'<b>'+esc(item.name)+'</b><small>'+(money(item.value))+'</small></div>').join("")+'</div></div><div class="roulette-edge-fade"></div></div><div class="opening-footer"><span>ПРОКРУТКА КЕЙСА</span><span>64 ПРЕДМЕТА В ЛЕНТЕ</span></div>';
}
async function animateRoll(duration=4200){
 const track=$("#roulette-track"),win=$("#roulette-window");if(!track||!win)return;
 const card=track.children[52];if(!card)return;
 track.style.transition="none";track.style.transform="translate3d(0,0,0)";void track.offsetWidth;
 const cardRect=card.getBoundingClientRect(),windowRect=win.getBoundingClientRect();
 const offset=cardRect.left+cardRect.width/2-(windowRect.left+windowRect.width/2);
 let tickTimer=null,audio=null;
 const tone=(frequency=760,volume=.025,length=.025)=>{
  try{const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)return;audio=audio||new AudioCtor();if(audio.state==="suspended")audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.type="triangle";osc.frequency.value=frequency;gain.gain.value=volume;osc.connect(gain);gain.connect(audio.destination);osc.start();gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+length);osc.stop(audio.currentTime+length)}catch{}
 };
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 tone(520,.018,.035);tickTimer=setInterval(()=>tone(820,.012,.018),115);
 track.style.transition="transform "+duration+"ms cubic-bezier(.08,.72,.08,1)";
 track.style.transform="translate3d(-"+offset+"px,0,0)";
 await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;track.removeEventListener("transitionend",onEnd);resolve()};const onEnd=e=>{if(e.propertyName==="transform")finish()};track.addEventListener("transitionend",onEnd);setTimeout(finish,duration+500)});
 if(tickTimer)clearInterval(tickTimer);tone(1040,.045,.18);
}
window.openCase=async(id,quick=false)=>{
 if(rolling)return;if(!me)return authModal();rolling=true;
 try{
  const caseData=await api("/api/cases/"+id);
  const d=await api("/api/cases/"+id+"/open",{method:"POST"});
  const items=makeRollItems(caseData.items,d);
  openModal(quick?"БЫСТРОЕ ОТКРЫТИЕ":"ОТКРЫТИЕ КЕЙСА",rouletteMarkup(items));
  await animateRoll(quick?3200:4200);
  $("#modal-body").innerHTML='<div class="win-result">'+skinArt(d.name)+'<p class="muted small">ТЕБЕ ВЫПАЛО</p><h3>'+esc(d.name)+'</h3><strong>'+money(d.value)+'</strong><small class="steam-price">'+rub(skinInfo(d.name).steamRub)+'</small></div><button class="btn primary full-btn" onclick="closeModal()">Забрать предмет</button>';
  await refresh();
 }catch(e){toast(e.message)}finally{rolling=false}
};
window.setUpgradeMode=mode=>{
 upgradeSettings.mode=mode==="fast"?"fast":"animated";saveUpgradeSettings();
 document.querySelectorAll(".upgrade-mode-row button").forEach((el,i)=>el.classList.toggle("active",i===(upgradeSettings.mode==="fast"?1:0)));
};
window.setUpgradeTheme=theme=>{
 const machine=$(".upgrade-machine")||$(".upgrade-section");if(!machine)return;
 machine.dataset.theme=["classic","neon","minimal"].includes(theme)?theme:"classic";
 try{localStorage.setItem("casearena-upgrade-theme",machine.dataset.theme)}catch{}
 document.querySelectorAll(".upgrade-theme-row button").forEach((el,i)=>el.classList.toggle("active",i===["classic","neon","minimal"].indexOf(machine.dataset.theme)));
};
const MAX_UPGRADE_SLOTS=6;
const HOUSE_EDGE=0.07;
const MAX_CHANCE=95;
function getUpgradeItems(){return upgradeSourceIds.map(id=>inventory.find(x=>x.id===id)).filter(Boolean).slice(0,MAX_UPGRADE_SLOTS)}
function getUpgradeStake(){return getUpgradeItems().reduce((sum,item)=>sum+Number(item.item_value||0),0)}
function getUpgradeChance(stake,target){if(!(stake>0)||!(target>0))return 0;if(target<=stake)return 100;const raw=(stake/target)*(1-HOUSE_EDGE)*100;return Math.max(1,Math.min(MAX_CHANCE,raw))}
function getQuickTargetValue(multiplier){return getUpgradeStake()*Number(multiplier)}
function renderUpgradeTargets(){
 const targets=$("#upgrade-targets");if(!targets)return;
 const query=String($("#upgrade-target-search")?.value||"").trim().toLowerCase();
 const min=Number($("#upgrade-target-min")?.value||0),max=Number($("#upgrade-target-max")?.value||0),stake=getUpgradeStake();
 const all=skins.filter(x=>x.value>stake&&(!query||x.name.toLowerCase().includes(query))&&(!min||x.value>=min)&&(!max||x.value<=max));
 const filtered=all.slice(0,72),count=$("#upgrade-target-count");if(count)count.textContent="Показано "+filtered.length+" из "+all.length;
 targets.innerHTML=filtered.map(x=>'<button class="pick-card target-card '+(upgradeTarget===x.name?"chosen":"")+'" onclick="chooseUpgradeTarget(&quot;'+esc(x.name)+'&quot;)">'+skinArt(x.name)+'<b>'+esc(x.name)+'</b><small>'+money(x.value)+'</small></button>').join("")||'<p class="muted small">Нет целей дороже общей ставки</p>';
}
window.filterUpgradeTargets=renderUpgradeTargets;
function renderUpgrade(){
 applyUpgradeWheelSettings();
 const source=$("#upgrade-source"),slots=$("#upgrade-selected-slots");if(!source)return;
 const machine=$(".upgrade-machine");if(machine&&!machine.dataset.theme){let theme="classic";try{theme=localStorage.getItem("casearena-upgrade-theme")||"classic"}catch{}machine.dataset.theme=["classic","neon","minimal"].includes(theme)?theme:"classic"}
 document.querySelectorAll(".upgrade-mode-row button").forEach((el,i)=>el.classList.toggle("active",i===(upgradeSettings.mode==="fast"?1:0)));
 document.querySelectorAll(".upgrade-theme-row button").forEach((el,i)=>el.classList.toggle("active",i===["classic","neon","minimal"].indexOf(machine?.dataset.theme||"classic")));
 const chosen=getUpgradeItems(),stake=getUpgradeStake();
 if(slots)slots.innerHTML=Array.from({length:6},(_,i)=>{const item=chosen[i];return '<div class="upgrade-slot '+(item?"filled":"")+'">'+(item?'<button type="button" class="upgrade-slot-remove" aria-label="Убрать предмет" onclick="chooseUpgradeSource('+item.id+')">×</button>'+skinArt(item.item_name)+'<b>'+esc(item.item_name)+'</b><small>'+money(item.item_value)+'</small>':'<span class="upgrade-slot-plus">+</span><small>Слот '+(i+1)+'</small>')+'</div>'}).join("");
 source.innerHTML=inventory.length?inventory.map(x=>'<button class="pick-card '+(upgradeSourceIds.includes(x.id)?"chosen":"")+'" onclick="chooseUpgradeSource('+x.id+')">'+skinArt(x.item_name)+'<b>'+esc(x.item_name)+'</b><small>'+money(x.item_value)+'</small><span class="upgrade-select-mark">'+(upgradeSourceIds.includes(x.id)?"✓ Выбран":"＋ Добавить")+'</span></button>').join(""):'<p class="muted small">Инвентарь пуст — сначала открой кейс</p>';
 const total=$("#upgrade-stake-total");if(total)total.textContent=money(stake);
 renderUpgradeTargets();updateUpgradePreview();
}
window.setUpgradeMultiplier=mult=>{
 const stake=getUpgradeStake();if(!stake)return toast("Сначала выбери хотя бы один скин");
 const target=skins.filter(x=>x.value>stake).sort((a,b)=>Math.abs(a.value-stake*Number(mult))-Math.abs(b.value-stake*Number(mult)))[0];
 if(!target)return toast("Не найдена подходящая цель");
 upgradeTarget=target.name;renderUpgrade();
 document.querySelectorAll("[data-upgrade-mult]").forEach(el=>el.classList.toggle("active",Number(el.dataset.upgradeMult)===Number(mult)));
 document.querySelectorAll("[data-upgrade-odds]").forEach(el=>el.classList.remove("active"));
};
window.setUpgradeOdds=pct=>{
 const stake=getUpgradeStake();if(!stake)return toast("Сначала выбери хотя бы один скин");
 const desiredTarget=stake*0.93/(Number(pct)/100);
 const target=skins.filter(x=>x.value>stake).sort((a,b)=>Math.abs(a.value-desiredTarget)-Math.abs(b.value-desiredTarget))[0];
 if(!target)return toast("Не найдена подходящая цель");
 upgradeTarget=target.name;renderUpgrade();
 document.querySelectorAll("[data-upgrade-odds]").forEach(el=>el.classList.toggle("active",Number(el.dataset.upgradeOdds)===Number(pct)));
 document.querySelectorAll("[data-upgrade-mult]").forEach(el=>el.classList.remove("active"));
};
window.randomUpgradeTarget=()=>{
 const stake=getUpgradeStake(),pool=skins.filter(x=>x.value>stake);
 if(!stake)return toast("Сначала выбери предметы для ставки");
 if(!pool.length)return toast("Нет доступных целей дороже ставки");
 const target=pool[Math.floor(Math.random()*pool.length)];
 upgradeTarget=target.name;renderUpgrade();
 document.querySelectorAll("[data-upgrade-mult],[data-upgrade-odds]").forEach(el=>el.classList.remove("active"));
};
window.chooseUpgradeSource=id=>{
 const index=upgradeSourceIds.indexOf(id);
 if(index>=0)upgradeSourceIds.splice(index,1);
 else{if(upgradeSourceIds.length>=6)return toast("Можно выбрать не больше 6 скинов");upgradeSourceIds.push(id)}
 upgradeSourceId=upgradeSourceIds[0]??null;renderUpgrade();
};
window.chooseUpgradeTarget=name=>{upgradeTarget=name;renderUpgrade();document.querySelectorAll("[data-upgrade-mult],[data-upgrade-odds]").forEach(el=>el.classList.remove("active"))};
applyUpgradeWheelSettings();
function playUpgradeSound(success){
 if(!upgradeSettings.sound)return;
 try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();if(ctx.state==="suspended")ctx.resume();[success?660:240,success?880:180].forEach((hz,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=hz;g.gain.setValueAtTime(.0001,ctx.currentTime+i*.13);g.gain.exponentialRampToValueAtTime(.08,ctx.currentTime+i*.13+.025);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+i*.13+.22);o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+i*.13);o.stop(ctx.currentTime+i*.13+.24)});setTimeout(()=>ctx.close(),800)}catch{}
}
function updateWheelLabels(dial,chance){
 if(!dial)return;
 const win=dial.querySelector(".wheel-sector-win"),fail=dial.querySelector(".wheel-sector-fail"),pct=Math.max(0,Math.min(100,Number(chance)||0));
 if(win)win.textContent="УСПЕХ "+pct.toFixed(1)+"%";
 if(fail)fail.textContent="НЕУДАЧА "+(100-pct).toFixed(1)+"%";
}
function updateUpgradePreview(){
 const box=$("#upgrade-preview"),chanceText=$("#upgrade-wheel-value"),wheel=$("#upgrade-wheel"),dial=$("#upgrade-wheel-dial"),status=$("#upgrade-spin-status"),win=$("#upgrade-success-percent"),fail=$("#upgrade-fail-percent");
 if(!box)return;
 const items=getUpgradeItems(),stake=getUpgradeStake(),target=skins.find(x=>x.name===upgradeTarget),chance=target?getUpgradeChance(stake,target.value):0;
 const fromArt=$("#upgrade-from-art"),toArt=$("#targetPreview"),fromName=$("#upgrade-from-name"),toName=$("#upgrade-to-name"),fromPrice=$("#upgrade-from-price"),toPrice=$("#upgrade-to-price");
 if(fromArt)fromArt.innerHTML=items.length?items.slice(0,3).map(x=>skinArt(x.item_name)).join(""):"<span>?</span>";
 if(toArt)toArt.innerHTML=target?skinArt(target.name):"<span>?</span>";
 if(fromName)fromName.textContent=items.length?items.length+" скинов выбрано":"Твои скины";
 if(toName)toName.textContent=target?target.name:"Желаемый скин";
 if(fromPrice)fromPrice.textContent=items.length?money(stake):"Выбери до 6 слева";
 if(toPrice)toPrice.textContent=target?money(target.value):"Выбери справа";
 if(dial){dial.style.transition="none";dial.style.transform="none";updateWheelLabels(dial,chance)}
 const pointer=$("#upgrade-wheel-pointer");if(pointer){pointer.style.transition="none";pointer.style.transform="rotate(180deg)"}
 if(!items.length||!target||target.value<=stake){
  const msg=!items.length?"Добавь от 1 до 6 скинов":!target?"Теперь выбери желаемый скин справа":"Цель должна быть дороже общей ставки";
  box.innerHTML='<span class="muted">'+msg+'</span>';if(chanceText)chanceText.textContent="—";const circle=$("#chanceCircle"),chanceLabel=$("#upgradeChance"),profitLabel=$("#upgradeProfit"),action=$("#doUpgradeBtn");if(circle)circle.style.setProperty("--chance","0%");if(chanceLabel)chanceLabel.textContent="0.0%";if(profitLabel)profitLabel.textContent="0 CR";if(action)action.disabled=true;if(wheel)wheel.style.setProperty("--chance","0%");if(status)status.textContent=msg;if(win)win.textContent="—";if(fail)fail.textContent="—";return;
 }
 const pct=Math.round(chance*100)/100,profit=target.value-stake; const circle=$("#chanceCircle"),chanceLabel=$("#upgradeChance"),profitLabel=$("#upgradeProfit"),action=$("#doUpgradeBtn");if(circle)circle.style.setProperty("--chance",pct+"%");if(chanceLabel)chanceLabel.textContent=pct.toFixed(1)+"%";if(profitLabel)profitLabel.textContent=money(profit);if(action)action.disabled=!(items.length&&target&&target.value>stake);
 if(chanceText)chanceText.textContent=pct.toFixed(1)+"%";if(wheel)wheel.style.setProperty("--chance",pct+"%");if(dial)updateWheelLabels(dial,chance);
 if(status)status.textContent="Комиссия 7% учтена · можно улучшать";
 if(win)win.textContent=pct.toFixed(1)+"%";if(fail)fail.textContent=(100-pct).toFixed(1)+"%";
 box.innerHTML='<div><b>'+items.length+' предметов · ставка '+money(stake)+'</b><div class="muted small">'+esc(target.name)+' · разница +'+money(profit)+'</div></div><div class="chance-number">'+pct.toFixed(1)+'%</div>';
}
window.upgrade=async()=>{
 if(!me)return authModal();if(rolling)return;
 const items=getUpgradeItems(),stake=getUpgradeStake(),target=skins.find(x=>x.name===upgradeTarget);
 if(!items.length)return toast("Выбери от 1 до 6 скинов");if(!target)return toast("Выбери целевой скин");if(target.value<=stake)return toast("Цель должна быть дороже общей ставки");
 rolling=true;
 try{
  upgradeSettings.mode=$("#fastUpgrade")&&$("#fastUpgrade").checked?"fast":"animated"; const d=await api("/api/upgrade",{method:"POST",body:JSON.stringify({itemIds:items.map(x=>x.id),targetName:target.name})});
  const chance=Math.max(0,Math.min(95,Number(d.chance)||0)),wheel=$("#upgrade-wheel"),pointer=$("#upgrade-wheel-pointer"),dial=$("#upgrade-wheel-dial"),status=$("#upgrade-spin-status");
  if($("#upgrade-wheel-value"))$("#upgrade-wheel-value").textContent=chance.toFixed(1)+"%";if(wheel)wheel.style.setProperty("--chance",chance+"%");
  if($("#upgrade-success-percent"))$("#upgrade-success-percent").textContent=chance.toFixed(1)+"%";if($("#upgrade-fail-percent"))$("#upgrade-fail-percent").textContent=(100-chance).toFixed(1)+"%";
  if(status)status.textContent=upgradeSettings.mode==="fast"?"Мгновенный результат":"Стрелка вращается…";
  if(dial){dial.style.transition="none";dial.style.transform="none";updateWheelLabels(dial,chance)}
  const spinSeconds=upgradeSettings.mode==="fast"?0.15:(upgradeSettings.speed===2?2:8)*(upgradeSettings.spinType===" азарт"?1.35:1);applyUpgradeWheelSettings();
  if(pointer&&upgradeSettings.mode!=="fast"){
   const arc=chance*3.6,landing=d.success?arc/2:arc+(360-arc)/2;
   pointer.style.transition="none";pointer.style.transform="rotate(0deg)";void pointer.offsetWidth;pointer.style.transition="transform "+spinSeconds+"s cubic-bezier(.08,.76,.12,1)";pointer.style.transform="rotate("+(360*7+180+landing)+"deg)";
  }
  await new Promise(resolve=>setTimeout(resolve,spinSeconds*1000+100));
  playUpgradeSound(!!d.success);openModal("РЕЗУЛЬТАТ АПГРЕЙДА",'<div class="win-result">'+skinArt(d.success?(d.targetName||target.name):items[0].item_name)+'<p class="muted small">'+(d.success?"АПГРЕЙД УСПЕШЕН":"НЕ ПОВЕЗЛО")+'</p><h3>'+(d.success?esc(d.targetName||target.name):"Предметы потеряны")+'</h3><strong>'+d.chance+'% шанс</strong><p class="muted small">'+esc(d.message)+'</p>'+(d.cashback?'<p class="upgrade-cashback">Возвращено '+money(d.cashback)+' · 10% ставки</p>':'')+'</div><button class="btn primary full-btn" onclick="closeModal()">Понятно</button>');
  upgradeSourceIds=[];upgradeSourceId=null;selected.clear();await refresh();
 }catch(e){toast(e.message)}finally{rolling=false}
};
function renderProfile(){const p=$("#profile-content");if(!p)return;if(!me){p.innerHTML='<p class="muted">Войди в аккаунт, чтобы увидеть профиль и инвентарь.</p>';$("#activity-list").innerHTML='<p class="muted small">История появится после входа.</p>';return}const total=inventory.reduce((s,x)=>s+Number(x.item_value),0);p.innerHTML='<div class="profile-head"><div class="avatar">'+esc(me.username.slice(0,2).toUpperCase())+'</div><div class="profile-main"><h3>'+esc(me.username)+roleBadge(me.role)+'</h3><div class="profile-stats"><span class="stat-chip">Баланс <b>'+money(me.balance)+'</b></span><span class="stat-chip">Предметы <b>'+inventory.length+'</b></span><span class="stat-chip">Инвентарь <b>'+money(total)+'</b></span></div></div></div><div id="profile-bonuses" class="bonus-panel"><p class="muted">Загружаю бонусы…</p></div><div class="inventory-toolbar"><h3>Мой инвентарь</h3><span class="muted small">Выбери от 3 до 5 предметов для контракта</span></div><div class="inventory">'+(inventory.length?inventory.map(x=>skinCard(x.item_name,x.item_value,{market:true,select:true,sell:true,id:x.id})).join(""):'<p class="muted">Инвентарь пока пуст. Открой первый кейс!</p>')+'</div>';loadActivity();loadBonusStatus()}
async function loadBonusStatus(){
 const box=$("#profile-bonuses");if(!box||!me)return;
 try{
  const d=await api("/api/bonus/status");
  const left=Math.max(0,d.hourlyReadyAt-Math.floor(Date.now()/1000));
  const time=left?Math.floor(left/60)+" мин "+(left%60)+" сек":"Доступно сейчас";
  box.innerHTML=
   '<div class="bonus-card"><div><b>Бесплатное пополнение</b><small>+10 000 CR · раз в час</small><em>'+(d.hourlyReady?"Можно забрать":"Следующее через "+time)+'</em></div><button class="btn primary" '+(!d.hourlyReady?"disabled":"")+' onclick="claimHourlyBonus()">Забрать +10 000</button></div>'+
   '<div class="bonus-card promo-card"><div><b>Промокод LUNACY</b><small>Одноразовый бонус +10 000 CR</small><em>'+(d.lunacyRedeemed?"Уже активирован":"Введи код ниже")+'</em></div>'+(d.lunacyRedeemed?'<span class="promo-used">Активирован</span>':'<form onsubmit="redeemLunacy(event)"><input name="code" placeholder="Введи промокод вручную" maxlength="30" autocomplete="off" required><button type="submit" class="btn secondary">Активировать вручную</button></form>')+'</div>'+
   '<div class="bonus-card promo-card"><div><b>Промокод GIFT</b><small>Одноразовый бонус +50 000 CR</small><em>'+(d.giftRedeemed?"Уже активирован":"Введи код ниже")+'</em></div>'+(d.giftRedeemed?'<span class="promo-used">Активирован</span>':'<form onsubmit="redeemLunacy(event)"><input name="code" placeholder="Введи GIFT" maxlength="30" autocomplete="off" required><button type="submit" class="btn secondary">Активировать</button></form>')+'</div>';
 }catch(e){box.innerHTML='<p class="muted">'+esc(e.message)+'</p>'}
}
window.claimHourlyBonus=async()=>{try{const d=await api("/api/bonus/hourly",{method:"POST",body:"{}"});me.balance=d.balance;renderAccount();toast("Получено +10 000 CR");await loadBonusStatus()}catch(e){toast(e.message);await loadBonusStatus()}};
window.redeemLunacy=async e=>{e.preventDefault();const code=String(new FormData(e.target).get("code")||"").trim();if(!code)return toast("Сначала введи промокод");if(!confirm("Активировать промокод "+code.toUpperCase()+"?"))return;try{const d=await api("/api/promo/redeem",{method:"POST",body:JSON.stringify({code})});me.balance=d.balance;renderAccount();toast("Промокод активирован: +"+money(d.amount));await loadBonusStatus()}catch(err){toast(err.message);await loadBonusStatus()}};
window.sellItem=async id=>{
 if(rolling)return;
 if(!confirm("Продать этот скин за его виртуальную стоимость?"))return;
 try{const d=await api("/api/inventory/"+id+"/sell",{method:"POST"});selected.delete(id);await refresh();toast("Скин продан. На баланс начислено "+money(d.sold))}catch(e){toast(e.message)}
};
window.toggleItem=(id,on)=>{on?selected.add(id):selected.delete(id);const count=selected.size;const hint=$(".inventory-toolbar .muted");if(hint)hint.textContent="Выбрано: "+count+" · для контракта нужно 3–5";renderUpgrade()};
async function loadActivity(){try{const rows=await api("/api/activity");$("#activity-list").innerHTML=rows.length?rows.map(a=>'<div class="activity-row"><span>'+esc(a.message)+'</span><time>'+new Date(a.created_at+"Z").toLocaleString("ru-RU",{dateStyle:"short",timeStyle:"short"})+'</time></div>').join(""):'<p class="muted small">Пока нет действий.</p>'}catch(e){$("#activity-list").innerHTML='<p class="muted small">История временно недоступна.</p>'}}
window.contract=async()=>{if(!me)return authModal();if(selected.size<3||selected.size>5)return toast("Выбери от 3 до 5 предметов");try{const d=await api("/api/contracts",{method:"POST",body:JSON.stringify({itemIds:[...selected]})});selected.clear();await refresh();toast(d.message)}catch(e){toast(e.message)}};
window.loadLeadersPage=()=>loadLeaders().catch(e=>{$("#leader-list").textContent="Таблица лидеров временно недоступна";console.warn(e)});
window.renderProfilePage=()=>renderProfile();
async function loadLeaders(){const rows=await api("/api/leaderboard");$("#leader-list").innerHTML=rows.length?rows.map((u,i)=>'<div class="rank"><b>#'+(i+1)+'</b><button class="player-link" onclick="viewPlayer(\''+esc(u.username)+'\')">'+esc(u.username)+roleBadge(u.role)+'</button><b class="rank-value">'+money(u.balance+u.inventory_value)+'</b></div>').join(""):'Пока нет игроков'}
window.viewPlayer=async username=>{try{const d=await api("/api/users/"+encodeURIComponent(username));const u=d.user;openModal("ПРОФИЛЬ ИГРОКА",'<div class="profile-head"><div class="avatar">'+esc(u.username.slice(0,2).toUpperCase())+'</div><div><h3>'+esc(u.username)+roleBadge(u.role)+'</h3><p class="muted small">В инвентаре '+d.inventory.length+' предметов · стоимость '+money(d.inventoryValue)+'</p></div></div><div class="public-inventory">'+(d.inventory.length?d.inventory.map(x=>skinCard(x.item_name,x.item_value,{market:true})).join(""):'<p class="muted">Инвентарь пуст</p>')+'</div>')}catch(e){toast(e.message)}};
async function loadBattles(){
 const bs=await api("/api/battles"),host=$("#battle-list");if(!host)return;
 host.innerHTML=bs.map(b=>{
  const max=Number(b.maxPlayers||4),joined=Math.max(0,Math.min(max,Number(b.players)||0)),running=String(b.status).toLowerCase().includes("идёт");
  const slots=Array.from({length:max},(_,i)=>'<div class="battle-player-slot '+(i<joined?"occupied":"empty")+'"><span class="battle-avatar">'+(i<joined?"👤":"＋")+'</span><small>'+(i<joined?"Игрок":"Свободно")+'</small></div>').join("");
  const caseIcons=Array.from({length:Math.max(1,Math.min(5,Number(b.rounds)||3))},()=>'<span class="battle-case-icon" title="Демо-кейс">🎁</span>').join("");
  return '<article class="battle battle-card"><div class="battle-card-top"><span class="battle-status '+(running?"is-live":"is-waiting")+'">'+(running?"● ИДЁТ":"◷ ОЖИДАЕТ")+'</span><span class="battle-demo-tag">ДЕМО</span></div><div class="battle-card-title"><div><strong>'+esc(b.name)+'</strong><small>'+Number(b.rounds||0)+' раундов · вход '+money(b.entry)+'</small></div><b class="battle-price">'+money(b.entry)+'</b></div><div class="battle-cases">'+caseIcons+'</div><div class="battle-players">'+slots+'</div><div class="battle-progress"><span style="width:'+Math.round(joined/max*100)+'%"></span></div><div class="battle-card-footer"><small>'+joined+'/'+max+' игроков · '+(running?"матч уже начался":"ожидание игроков")+'</small>'+(running?'<button class="btn secondary" onclick="viewBattle('+b.id+')">◉ Смотреть</button>':'<button class="btn primary" onclick="joinBattle('+b.id+','+b.entry+')">Присоединиться</button>')+'</div></article>';
 }).join("");
}
window.viewBattle=id=>{openModal("КЕЙС-БАТТЛ #"+id,'<div class="battle-watch"><div class="battle-watch-icon">⚔</div><h3>Демо-матч</h3><p class="muted">Этот баттл пока демонстрационный: просмотр раундов и реальные игроки ещё не подключены.</p><button class="btn primary full-btn" onclick="closeModal()">Понятно</button></div>')};
window.joinBattle=async(id,entry)=>{try{const d=await api("/api/battles/"+id+"/join",{method:"POST",body:JSON.stringify({entry})});await refresh();toast(d.message)}catch(e){toast(e.message)}};
window.switchArenaMode=mode=>{
 const battles=$("#arena-battles"),upgrade=$("#arena-upgrade");
 if(!battles||!upgrade)return;
 const showUpgrade=mode==="upgrade";
 battles.classList.toggle("active",!showUpgrade);
 upgrade.classList.toggle("active",showUpgrade);
 document.querySelectorAll(".arena-switcher button").forEach((button,index)=>button.classList.toggle("active",index===(showUpgrade?1:0)));
 if(showUpgrade)renderUpgrade();
};

async function loadStaff(search=""){
 const box=$("#staff-content");
 if(!box||!me||roleRank(me.role)<1)return;
 const q=String(search||"");
 box.innerHTML='<p class="muted">Загружаю список игроков…</p>';
 try{
  const d=await api("/api/staff/users?search="+encodeURIComponent(q));
  const users=d.users||[], actorRank=roleRank(me.role);
  const rows=users.map(u=>{
   const targetRank=roleRank(u.role), protectedOwner=actorRank<=targetRank, canManage=!protectedOwner&&Number(u.id)!==Number(me.id);
   const actions=[];
   if(protectedOwner)actions.push('<span class="owner-shield">🛡 Защищён от твоей роли</span>');
   else if(canManage){
    if(actorRank>=2){
     actions.push('<button class="btn danger" onclick="staffAction('+u.id+',\'ban\')">Бан</button>');
     actions.push('<button class="btn secondary" onclick="staffAction('+u.id+',\'unban\')">Разбан</button>');
    }else if(u.role==="user")actions.push('<button class="btn secondary" onclick="staffAction('+u.id+',\'kick\')">Кик</button>');
    if(actorRank>=2){
     const options=ROLE_ORDER.slice(0,actorRank).map(role=>'<option value="'+role+'" '+(u.role===role?"selected":"")+'>'+ROLE_LABELS[role]+'</option>').join("");
     actions.push('<select class="staff-role-select" id="staff-role-'+u.id+'">'+options+'</select><button class="btn secondary" onclick="staffAction('+u.id+',\'set_role\')">Сменить роль</button>');
     actions.push('<button class="btn secondary" onclick="staffAction('+u.id+',\'kick\')">Кик</button>');
    }
   }
   return '<div class="staff-row"><div><b>'+esc(u.username)+'</b> '+roleBadge(u.role)+'<small>'+(u.banned?"ЗАБЛОКИРОВАН":"Аккаунт активен")+' · '+Number(u.item_count||0)+' предметов · регистрация '+esc(String(u.created_at||"").slice(0,10)||"—")+'</small></div><div class="staff-actions">'+actions.join("")+'</div></div>';
  });
  box.innerHTML='<div class="staff-toolbar"><div><b>Игроки сервера · '+users.length+'</b><small class="muted">Все аккаунты, включая игроков без открытых кейсов · твоя роль: '+ROLE_LABELS[me.role]+'</small></div><input id="staff-search" placeholder="Поиск по нику…" value="'+esc(q)+'" oninput="searchStaffUsers(this.value)"></div><div class="staff-list">'+(rows.length?rows.join(""):'<p class="muted">Игроки не найдены</p>')+'</div>';
 }catch(e){box.innerHTML='<p class="muted">'+esc(e.message)+'</p>'}
}
let staffSearchTimer=null;
window.searchStaffUsers=value=>{clearTimeout(staffSearchTimer);staffSearchTimer=setTimeout(()=>loadStaff(value),250)};
window.staffAction=async(id,action)=>{
 const role=action==="set_role"?$("#staff-role-"+id)?.value:undefined;
 const label=action==="set_role"?"изменить роль на "+(ROLE_LABELS[role]||role):action==="ban"?"заблокировать":action==="kick"?"отключить":"снять блокировку";
 if(!confirm("Ты действительно хочешь "+label+" этого игрока?"))return;
 try{const d=await api("/api/staff/users/"+id+"/action",{method:"POST",body:JSON.stringify({action,role})});toast(d.message);await loadStaff($("#staff-search")?.value||"")}
 catch(e){toast(e.message)}
};
async function loadOwner(search=ownerSearchQuery){
 ownerSearchQuery=String(search||'');
 const box=$("#owner-content");
 if(!me||!["owner","co_owner"].includes(me.role)){box.innerHTML='<p class="muted">Доступ запрещён.</p>';return}
 box.innerHTML='<p class="muted">Загружаю данные панели…</p>';
 try{
  const d=await api("/api/owner/overview"+(ownerSearchQuery?"?search="+encodeURIComponent(ownerSearchQuery):""));
  const users=Array.isArray(d.users)?d.users:[];
  const activity=Array.isArray(d.activity)?d.activity:[];
  const inventoryValue=Number(d.totalInventoryValue||0);
  box.innerHTML=
   '<div class="owner-stats">'+
    '<div class="owner-stat"><small>АККАУНТОВ</small><b>'+Number(d.totalUsers||0)+'</b></div>'+
    '<div class="owner-stat"><small>ПРЕДМЕТОВ У ИГРОКОВ</small><b>'+Number(d.totalItems||0)+'</b></div>'+
    '<div class="owner-stat"><small>БАЛАНСЫ ИГРОКОВ</small><b>'+money(d.totalBalance)+'</b></div>'+
    '<div class="owner-stat"><small>СТОИМОСТЬ ИНВЕНТАРЯ</small><b>'+money(inventoryValue)+'</b></div>'+
   '</div>'+
   '<div class="owner-toolbar"><div><h3>Управление игроками</h3><small class="muted">Все аккаунты, включая игроков без открытых кейсов. Гарантированный дроп выдаётся на следующее открытие.</small></div><div class="owner-toolbar-actions"><input id="owner-search" value="'+esc(ownerSearchQuery)+'" placeholder="Поиск по нику…" oninput="searchOwnerUsers(this.value)"><button class="btn secondary" onclick="loadOwner()">Обновить</button></div></div>'+
   '<div id="owner-users" class="owner-users">'+(users.length?users.map(u=>{
    const targetRank=roleRank(u.role);
    const isSelf=Number(u.id)===Number(me.id);
    const locked=isSelf||roleRank(me.role)<=targetRank;
    const balanceLocked=locked&&!(isSelf&&me.role==="owner");
    const disabled=balanceLocked?"disabled":"";
    const roleDisabled=locked?"disabled":"";
    const moderation=locked?"":(Number(u.banned)===1
      ? '<button class="btn secondary" onclick="ownerUnban('+u.id+')">Разбанить</button>'
      : '<button class="btn danger" onclick="ownerBan('+u.id+')">Заблокировать</button>')+
      '<button class="btn danger" onclick="deleteUser('+u.id+',\''+esc(u.username)+'\')">Удалить</button>';
    return '<div class="user-row" data-user="'+esc(u.username.toLowerCase())+'">'+
     '<div class="user-info"><b>'+esc(u.username)+'</b> '+roleBadge(u.role)+
     '<small>'+(Number(u.banned)===1?'ЗАБЛОКИРОВАН · ':'Аккаунт активен · ')+esc(ROLE_LABELS[u.role]||u.role)+' · '+Number(u.item_count||0)+' предметов · инвентарь '+money(u.inventory_value)+(Number(u.forced_drop)===1?' · ГАРАНТИРОВАННЫЙ ДРОП ВКЛЮЧЁН':'')+'</small></div>'+
     '<div class="owner-field"><small>БАЛАНС · '+money(u.balance)+'</small><input id="bal-'+u.id+'" type="number" min="0" max="100000000" placeholder="Сумма" '+disabled+'></div>'+
     '<div class="owner-actions owner-balance-actions">'+
      '<button class="btn primary" onclick="ownerBalance('+u.id+',\'add\')" '+disabled+'>Выдать +</button>'+
      '<button class="btn secondary" onclick="ownerBalance('+u.id+',\'set\')" '+disabled+'>Задать</button>'+
     '</div>'+
     '<label class="owner-field"><small>РОЛЬ</small><select id="role-'+u.id+'" '+roleDisabled+'>'+ROLE_ORDER.filter(role=>roleRank(role)<roleRank(me.role)).map(role=>'<option value="'+role+'" '+(u.role===role?"selected":"")+'>'+ROLE_LABELS[role]+'</option>').join("")+'</select></label>'+
     '<div class="owner-actions"><button class="btn secondary" onclick="ownerRole('+u.id+')" '+roleDisabled+'>Сохранить роль</button>'+
     (locked?'':'<button class="btn '+(Number(u.forced_drop)===1?'danger':'primary')+'" onclick="ownerForcedDrop('+u.id+','+(Number(u.forced_drop)===1?'false':'true')+')">'+(Number(u.forced_drop)===1?'Отключить дроп':'Выдать лучший дроп')+'</button>')+moderation+'</div></div>';
   }).join(""):'<p class="muted">'+(ownerSearchQuery?"По этому нику игроки не найдены.":"Пока нет игроков.")+'</p>')+'</div>'+
   '<div class="owner-activity"><h3>Последние действия</h3>'+
   (activity.length?activity.map(item=>'<p><b>'+esc(item.username||"Система")+'</b><span>'+esc(item.message)+'</span></p>').join(""):'<p class="muted">Действий пока нет.</p>')+
   '</div>';
 }catch(e){
  box.innerHTML='<p class="muted">Не удалось загрузить панель: '+esc(e.message)+'</p><button class="btn secondary" onclick="loadOwner()">Повторить</button>';
 }
}
window.loadOwner=loadOwner;
window.loadStaff=loadStaff;
let ownerSearchQuery="";
let ownerSearchTimer=null;
window.searchOwnerUsers=value=>{ownerSearchQuery=String(value||"").trim();clearTimeout(ownerSearchTimer);ownerSearchTimer=setTimeout(()=>loadOwner(ownerSearchQuery),280)};
window.ownerForcedDrop=async(id,enabled)=>{
 if(!confirm(enabled?"Включить для игрока гарантированный самый дорогой скин при следующем открытии кейса?":"Отключить гарантированный дроп?"))return;
 try{const d=await api("/api/owner/users/"+id+"/forced-drop",{method:"POST",body:JSON.stringify({enabled})});await loadOwner();toast(enabled?"Гарантированный дроп включён для "+d.username:"Гарантированный дроп отключён")}
 catch(e){toast(e.message)}
};
window.ownerBalance=async(id,mode)=>{
 const field=$("#bal-"+id),amount=Number(field?.value);
 if(!Number.isInteger(amount)||amount<(mode==="add"?1:0)){toast("Укажи корректную сумму");return}
 if(mode==="set"&&!confirm("Установить игроку новый баланс "+money(amount)+"?"))return;
 try{const d=await api("/api/owner/users/"+id+"/balance",{method:"POST",body:JSON.stringify({amount,mode})});await loadOwner();toast(mode==="add"?"Баланс выдан. Новый баланс: "+money(d.balance):"Баланс изменён: "+money(d.balance))}
 catch(e){toast(e.message)}
};
window.ownerRole=async id=>{
 const role=$("#role-"+id)?.value;
 try{await api("/api/owner/users/"+id+"/role",{method:"POST",body:JSON.stringify({role})});await loadOwner();toast("Роль игрока изменена")}
 catch(e){toast(e.message)}
};
window.ownerBan=async id=>{if(!confirm("Заблокировать этого игрока?"))return;try{const d=await api("/api/staff/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"ban"})});await loadOwner();toast(d.message)}catch(e){toast(e.message)}};
window.ownerUnban=async id=>{if(!confirm("Снять блокировку с этого игрока?"))return;try{const d=await api("/api/staff/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"unban"})});await loadOwner();toast(d.message)}catch(e){toast(e.message)}};
window.deleteUser=async(id,username)=>{
 if(!confirm("Удалить аккаунт "+username+" и весь его инвентарь?"))return;
 try{await api("/api/owner/users/"+id,{method:"DELETE"});await loadOwner();toast("Аккаунт удалён")}catch(e){toast(e.message)}
};
initDemoLiveStats();
(async()=>{const jobs=[["скины",loadSkins],["кейсы",loadCases],["топ дропов",loadTopDrops],["баттлы",loadBattles],["лидеры",loadLeaders],["профиль",refresh]];const results=await Promise.allSettled(jobs.map(([,run])=>run()));results.forEach((result,i)=>{if(result.status==="rejected"){const [name]=jobs[i];console.error("CaseArena: не загрузились "+name,result.reason);if(name==="кейсы")$("#case-grid").innerHTML='<p class="muted">Не удалось загрузить кейсы. Обнови страницу.</p>';if(name==="баттлы")$("#battle-list").innerHTML='<p class="muted">Баттлы временно недоступны.</p>';if(name==="лидеры")$("#leader-list").textContent="Таблица лидеров временно недоступна";}});const p=new URLSearchParams(location.search);if(p.get("chooseNick")==="1")nicknameModal();else if(p.get("google")==="unavailable"){toast("Вход через Google ещё не настроен на сервере");history.replaceState({},"",location.pathname)}else if(p.has("google")){toast("Ошибка входа через Google. Проверь настройки OAuth и попробуй снова.");history.replaceState({},"",location.pathname)}setInterval(()=>{if(!document.hidden)loadLeaders().catch(e=>console.warn("Leaderboard auto-refresh failed:",e.message))},15000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)loadLeaders().catch(e=>console.warn("Leaderboard refresh failed:",e.message))})})();

/* Reliable single-page navigation */
(()=>{
 const pageNodes=()=>[...document.querySelectorAll(".page-view[data-page]")];
 const nav=document.querySelector(".bottom-nav");
 let currentPage="cases";
 function render(page,updateUrl=true){
  page=String(page||currentPage||"cases").replace(/^#/,"");
  if(page==="battles"||page==="upgrade")page="arena";
  if(!pageNodes().some(node=>node.dataset.page===page))page="cases";
  if(page==="owner"&&!window.canAccessOwner?.())page="cases";
  if(page==="staff"&&!window.canAccessStaff?.())page="cases";
  currentPage=page;
  pageNodes().forEach(node=>node.classList.toggle("active-page",node.dataset.page===page));
  document.querySelectorAll("[data-nav]").forEach(link=>link.classList.toggle("active",link.dataset.nav===page));
  if(updateUrl&&location.hash!=="#"+page)history.pushState({page},"","#"+page);
  if(page==="staff")Promise.resolve(window.loadStaff?.()).catch(error=>console.error("Staff page:",error));
  if(page==="owner")Promise.resolve(window.loadOwner?.()).catch(error=>console.error("Owner page:",error));
  if(page==="leaders")Promise.resolve(window.loadLeadersPage?.()).catch(error=>console.error("Leaders page:",error));
  if(page==="profile")window.renderProfilePage?.();
  document.title="CaseArena — "+({cases:"Кейсы",skins:"Скины",arena:"Арена",contracts:"Контракты",profile:"Профиль",leaders:"Лидеры",owner:"Панель владельца",staff:"Персонал","case-detail":"Кейс"}[page]||"CaseArena");
  window.scrollTo({top:0,behavior:"instant"});
 }
 window.renderCaseArenaPage=page=>render(page);
 window.navigateCaseArenaPage=page=>render(page);
 document.addEventListener("click",event=>{
  const link=event.target instanceof Element?event.target.closest('a[href^="#"]'):null;
  if(!link)return;
  const target=link.getAttribute("href").slice(1);
  const page=link.dataset.nav||target;
  if(!page||!pageNodes().some(node=>node.dataset.page===page))return;
  event.preventDefault();
  event.stopImmediatePropagation();
  render(page);
 },true);
 window.addEventListener("popstate",()=>render(location.hash||"cases",false));
 window.addEventListener("hashchange",()=>{if((location.hash||"#cases").slice(1)!==currentPage)render(location.hash||"cases",false)});
 render(location.hash||"cases",false);
})();
/* =========================================
   ДЕМОНСТРАЦИОННАЯ ЛЕНТА ПРЕДМЕТОВ
   Это примеры, не реальные выигрыши игроков.
   ========================================= */
function initDropFeed() {
  const feed = document.getElementById("dropFeed");
  if (!feed || feed.dataset.initialized === "1") return;
  feed.dataset.initialized = "1";

  const demoDrops = [
    { name: "AWP | Dragon Lore", price: 507473, img: "https://community.cloudflare.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERN1z2z0hwfSSqZ6F7I3vEMjx7M_CW1mLh19duY2z2wX1JvBqi4XlF_a3pQ/360fx360f" },
    { name: "★ Karambit | Doppler", price: 150059, img: "https://community.cloudflare.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERN1z2z0hwfSSqZ6F7I3vEMjx7M_CW1mLh19duY2z2wX1JvBqi4XlF_a3pQ/360fx360f" },
    { name: "AK-47 | Neon Rider", price: 4776, img: "https://community.cloudflare.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERN1z2z0hwfSSqZ6F7I3vEMjx7M_CW1mLh19duY2z2wX1JvBqi4XlF_a3pQ/360fx360f" },
    { name: "M4A1-S | Printstream", price: 17905, img: "https://community.cloudflare.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERN1z2z0hwfSSqZ6F7I3vEMjx7M_CW1mLh19duY2z2wX1JvBqi4XlF_a3pQ/360fx360f" },
    { name: "Butterfly Knife | Fade", price: 135516, img: "https://community.cloudflare.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERN1z2z0hwfSSqZ6F7I3vEMjx7M_CW1mLh19duY2z2wX1JvBqi4XlF_a3pQ/360fx360f" }
  ];
  const itemsHTML = [...demoDrops, ...demoDrops].map(item => `
    <div class="drop-item">
      <img loading="lazy" src="${item.img}" alt="${item.name}">
      <span class="drop-name">${item.name}</span>
      <span class="drop-price">${item.price.toLocaleString("ru-RU")} CR</span>
    </div>
  `).join("");
  feed.innerHTML = itemsHTML;
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDropFeed, { once: true });
} else {
  initDropFeed();
}
