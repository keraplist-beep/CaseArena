const $=s=>document.querySelector(s);
let me=null, inventory=[], selected=new Set(), skins=[], casesCache=[], upgradeSourceId=null, upgradeTarget=null, rolling=false;
const money=n=>Number(n||0).toLocaleString("ru-RU")+" CR";
const rub=n=>"≈ "+Number(n||0).toLocaleString("ru-RU")+" ₽";
const api=async(url,opts={})=>{const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||"Ошибка запроса");return d};
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function toast(t){const el=$("#toast");el.textContent=t;el.style.display="block";clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.style.display="none",3000)}
function openModal(title,html){$("#modal-title").textContent=title;$("#modal-body").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden")}
window.closeModal=closeModal;
function authModal(){openModal("Вход в CaseArena",'<a class="btn secondary google-btn" href="/auth/google"><b>G</b> Продолжить с Google</a><p class="muted small">Или войди по игровому нику.</p><div class="inline"><button class="btn secondary" onclick="authForm(\'login\')">Войти</button><button class="btn secondary" onclick="authForm(\'register\')">Регистрация</button></div><div id="auth-form"></div>');authForm("login")}
window.authModal=authModal;
window.authForm=mode=>{$("#auth-form").innerHTML='<form onsubmit="submitAuth(event,\''+mode+'\')"><input name="username" placeholder="Никнейм" minlength="3" maxlength="20" required><input name="password" type="password" placeholder="Пароль (минимум 10 символов)" minlength="10" required><button class="btn primary">'+(mode==="login"?"Войти":"Создать аккаунт")+'</button></form>'};
window.submitAuth=async(e,mode)=>{e.preventDefault();const f=new FormData(e.target);try{await api("/api/"+(mode==="login"?"login":"register"),{method:"POST",body:JSON.stringify(Object.fromEntries(f))});closeModal();await refresh();toast("Добро пожаловать в CaseArena")}catch(err){toast(err.message)}};
function nicknameModal(){openModal("Выбери игровой ник",'<p class="muted">Google подключён. Придумай ник для профиля.</p><form onsubmit="completeGoogleNick(event)"><input name="username" placeholder="Например, DragonKing" minlength="3" maxlength="20" required><button class="btn primary">Продолжить</button></form>')}
window.completeGoogleNick=async e=>{e.preventDefault();const username=new FormData(e.target).get("username");try{await api("/api/google/complete-nickname",{method:"POST",body:JSON.stringify({username})});closeModal();history.replaceState({},"",location.pathname);await refresh()}catch(err){toast(err.message)}};
function renderAccount(){const a=$("#account");if(!a)return;a.innerHTML=me?'<button class="profile-shortcut" onclick="goProfile()"><span class="mini-avatar">'+esc(me.username.slice(0,1).toUpperCase())+'</span><span class="account-name">'+esc(me.username)+(me.role==="owner"?' <b class="owner-tag">OWNER</b>':'')+'<small>'+money(me.balance)+'</small></span></button><button class="btn secondary" onclick="logout()">Выйти</button>':'<button class="btn secondary" onclick="authModal()">Войти</button><button class="btn primary" onclick="authModal()">Регистрация</button>'}
window.canAccessOwner=()=>me?.role==="owner";
window.ownerAccessReady=false;
window.updateOwnerNavigation=()=>{
 const nav=document.querySelector(".bottom-nav");if(!nav)return;
 let owner=nav.querySelector('[data-nav="owner"]'),staff=nav.querySelector('[data-nav="staff"]');
 if(me?.role==="owner"&&!owner){owner=document.createElement("a");owner.href="#owner";owner.dataset.nav="owner";owner.innerHTML='<span class="bottom-nav-icon">🛡</span><span>Владелец</span>';nav.appendChild(owner)}
 if(me?.role!=="owner"&&owner)owner.remove();
 if(me&&["owner","admin","moderator"].includes(me.role)&&!staff){staff=document.createElement("a");staff.href="#staff";staff.dataset.nav="staff";staff.innerHTML='<span class="bottom-nav-icon">🛠</span><span>Персонал</span>';nav.appendChild(staff)}
 if((!me||!["owner","admin","moderator"].includes(me.role))&&staff)staff.remove();
 nav.classList.toggle("owner-mode",me?.role==="owner");window.renderCaseArenaPage?.();
};
window.goProfile=()=>{location.hash="profile"};
window.logout=async()=>{try{await api("/api/logout",{method:"POST"});me=null;inventory=[];selected.clear();renderAccount();renderProfile();renderUpgrade();window.updateOwnerNavigation?.();toast("Вы вышли из аккаунта")}catch(e){toast(e.message)}};
async function refresh(){const d=await api("/api/me");me=d.user;inventory=d.inventory||[];if(!inventory.some(x=>x.id===upgradeSourceId))upgradeSourceId=inventory[0]?.id??null;renderAccount();renderProfile();renderUpgrade();window.ownerAccessReady=true;window.updateOwnerNavigation?.();if(me?.role==="owner")await loadOwner();else $("#owner-content").innerHTML="";if(me&&["owner","admin","moderator"].includes(me.role))await loadStaff();else $("#staff-content").innerHTML="";}
function skinInfo(name){return skins.find(x=>x.name===name)||{name,value:0,steamRub:0,rarity:"Предмет",image:"",steamUrl:"https://steamcommunity.com/market/search?appid=730&q="+encodeURIComponent(name)}}
function skinArt(name){const s=skinInfo(name);const glyph=name.startsWith("★")?"✦":name.split(" | ")[0].slice(0,3).toUpperCase();const image=s.image||"";return '<div class="skin-art '+(image?"":"no-image")+'">'+(image?'<img loading="lazy" src="'+esc(image)+'" alt="'+esc(name)+'" onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-image\')">':'')+'<span class="skin-glyph">'+esc(glyph)+'</span></div>'}
function skinCard(name,value,opts={}){const s=skinInfo(name);return '<article class="skin-card rarity-'+esc((s.rarity||"").toLowerCase().replace(/[^a-zа-яё]+/g,"-"))+'">'+skinArt(name)+'<div class="skin-card-info"><span class="rarity-text">'+esc(s.rarity||"CS2")+'</span><b>'+esc(name)+'</b><strong>'+money(value??s.value)+'</strong><small class="steam-price">'+rub(s.steamRub)+'</small>'+(opts.market?'<a class="market-link" href="'+esc(s.steamUrl)+'" target="_blank" rel="noopener">Steam Market ↗</a>':'')+(opts.select?'<label class="select-item"><input type="checkbox" '+(selected.has(opts.id)?"checked":"")+' onchange="toggleItem('+opts.id+',this.checked)"> Выбрать</label>':'')+(opts.sell?'<button class="btn secondary sell-skin-btn" onclick="sellItem('+opts.id+')">Продать за '+money(value??s.value)+'</button>':'')+'</div></article>'}
async function loadSkins(){skins=await api("/api/skins")}
async function loadCases(){casesCache=await api("/api/cases");$("#case-grid").innerHTML=casesCache.map((c,i)=>'<article class="case-card case-theme-'+esc(c.theme||"classic")+'" onclick="showCase(\''+esc(c.id)+'\')"><div class="case-visual case-visual-photo"><span class="case-index">CASE / '+String(i+1).padStart(2,"0")+'</span><div class="case-art-mark">'+esc(c.name)+'</div>'+(c.image?'<img class="case-cover-image" loading="lazy" src="'+esc(c.image)+'" alt="'+esc(c.name)+'" onerror="this.style.display=\'none\'">':'<div class="case-box-art">✦</div>')+'<span class="case-cover-glow"></span><span class="case-art-sub">CASEARENA • '+Number(c.count||0)+' SKINS</span></div><div class="case-info"><h3>'+esc(c.name)+'</h3><p class="case-subtitle">'+esc(c.subtitle||"Коллекция CS2")+'</p><div class="case-bottom"><span class="price">'+money(c.price)+'</span><button class="btn primary" onclick="event.stopPropagation();showCase(\''+esc(c.id)+'\')">Смотреть кейс</button></div></div></article>').join("")}
window.showCase=async id=>{try{const d=await api("/api/cases/"+id);const content='<div class="case-detail case-theme-'+esc(d.theme)+'"><div class="case-detail-hero"><div class="case-detail-art">'+esc(d.name)+'</div>'+(d.image?'<img src="'+esc(d.image)+'" alt="'+esc(d.name)+'">':'')+'<span>'+esc(d.subtitle)+'</span></div><div class="case-detail-heading"><div><h3>'+esc(d.name)+'</h3><p class="muted small">'+d.count+' предметов в кейсе</p></div><strong>'+money(d.price)+'</strong></div><div class="case-detail-items">'+d.items.map(item=>'<article class="case-drop-card"><div class="case-drop-image">'+(item.image?'<img src="'+esc(item.image)+'" alt="'+esc(item.name)+'">':'<span>CS2</span>')+'</div><b>'+esc(item.name)+'</b><small>'+money(item.value)+'</small><em>'+Number(item.chance).toLocaleString("ru-RU")+'%</em></article>').join("")+'</div><button class="btn primary full-btn" onclick="closeModal();openCase(\''+esc(d.id)+'\')">Открыть за '+money(d.price)+'</button></div>';openModal("СОДЕРЖИМОЕ КЕЙСА",content)}catch(e){toast(e.message)}};

function makeRollItems(winnerName,success=true){const pool=skins.length?skins.map(s=>s.name):["AK-47 | Redline","AWP | Asiimov"];const arr=Array.from({length:31},()=>pool[Math.floor(Math.random()*pool.length)]);arr[25]=success?winnerName:"Неудача";return arr}
function rouletteMarkup(items,winner){return '<div class="roulette-shell"><div class="roulette-pointer"></div><div class="roulette-window" id="roulette-window"><div class="roulette-track" id="roulette-track">'+items.map((n,i)=>'<div class="roulette-skin '+(i===25?'roulette-winner':'')+'">'+skinArt(n)+'<b>'+esc(n)+'</b><small>'+(i===25?esc(winner):"CS2 SKIN")+'</small></div>').join("")+'</div></div></div>'}
async function animateRoll(){const track=$("#roulette-track"),win=$("#roulette-window");if(!track||!win)return;requestAnimationFrame(()=>{const card=track.children[25];const offset=card.offsetLeft+card.offsetWidth/2-win.clientWidth/2;track.style.transform="translateX(-"+offset+"px)"});await new Promise(r=>setTimeout(r,4300))}
window.openCase=async id=>{if(rolling)return;if(!me)return authModal();rolling=true;try{const d=await api("/api/cases/"+id+"/open",{method:"POST"});const items=makeRollItems(d.name,true);openModal("ОТКРЫТИЕ КЕЙСА",rouletteMarkup(items,money(d.value))+'<p class="roulette-caption">Кейс открывается…</p>');await animateRoll();$("#modal-body").innerHTML='<div class="win-result">'+skinArt(d.name)+'<p class="muted small">ТЕБЕ ВЫПАЛО</p><h3>'+esc(d.name)+'</h3><strong>'+money(d.value)+'</strong><small class="steam-price">'+rub(skinInfo(d.name).steamRub)+'</small></div><button class="btn primary full-btn" onclick="closeModal()">Забрать предмет</button>';await refresh()}catch(e){toast(e.message)}finally{rolling=false}};
function renderUpgrade(){const source=$("#upgrade-source"),targets=$("#upgrade-targets");if(!source||!targets)return;source.innerHTML=inventory.length?inventory.map(x=>'<button class="pick-card '+(upgradeSourceId===x.id?"chosen":"")+'" onclick="chooseUpgradeSource('+x.id+')">'+skinArt(x.item_name)+'<b>'+esc(x.item_name)+'</b><small>'+money(x.item_value)+'</small></button>').join(""):'<p class="muted small">Инвентарь пуст — сначала открой кейс</p>';targets.innerHTML=skins.map(x=>'<button class="pick-card target-card '+(upgradeTarget===x.name?"chosen":"")+'" onclick="chooseUpgradeTarget(\''+esc(x.name)+'\')">'+skinArt(x.name)+'<b>'+esc(x.name)+'</b><small>'+money(x.value)+'</small><em>'+rub(x.steamRub)+'</em></button>').join("");updateUpgradePreview()}
window.setUpgradeMultiplier=mult=>{const item=inventory.find(x=>x.id===upgradeSourceId);if(!item)return toast("Сначала выбери свой предмет");const target=skins.filter(x=>x.value>=item.item_value*mult).sort((x,y)=>Math.abs(x.value-item.item_value*mult)-Math.abs(y.value-item.item_value*mult))[0];if(!target)return toast("Нет подходящего скина для X"+mult);upgradeTarget=target.name;renderUpgrade()};
window.chooseUpgradeSource=id=>{upgradeSourceId=id;renderUpgrade()};
window.chooseUpgradeTarget=name=>{upgradeTarget=name;renderUpgrade()};
function updateUpgradePreview(){const box=$("#upgrade-preview"),chanceText=$("#upgrade-wheel-value"),fill=$("#upgrade-chance-fill"),status=$("#upgrade-spin-status"),win=$("#upgrade-success-percent"),fail=$("#upgrade-fail-percent");if(!box)return;const item=inventory.find(x=>x.id===upgradeSourceId),target=skins.find(x=>x.name===upgradeTarget);const fromArt=$("#upgrade-from-art"),toArt=$("#upgrade-to-art"),fromName=$("#upgrade-from-name"),toName=$("#upgrade-to-name"),fromPrice=$("#upgrade-from-price"),toPrice=$("#upgrade-to-price");if(fromArt)fromArt.innerHTML=item?skinArt(item.item_name):"<span>?</span>";if(toArt)toArt.innerHTML=target?skinArt(target.name):"<span>?</span>";if(fromName)fromName.textContent=item?item.item_name:"Твой предмет";if(toName)toName.textContent=target?target.name:"Желаемый скин";if(fromPrice)fromPrice.textContent=item?money(item.item_value):"Выбери слева";if(toPrice)toPrice.textContent=target?money(target.value):"Выбери справа";if(!item||!target||target.value<=item.item_value){const msg=!item?"Сначала выбери предмет из инвентаря":!target?"Теперь выбери желаемый скин справа":"Целевой предмет должен стоить дороже";box.innerHTML='<span class="muted">'+msg+'</span>';if(chanceText)chanceText.textContent="—";if(fill)fill.style.width="0%";if(status)status.textContent=msg;if(win)win.textContent="—";if(fail)fail.textContent="—";return}const chance=Math.min(75,item.item_value/target.value*75),pct=Math.round(chance);if(chanceText)chanceText.textContent=pct+"%";if(fill)fill.style.width=pct+"%";if(status)status.textContent="Шанс рассчитан. Готов к апгрейду";if(win)win.textContent=pct+"%";if(fail)fail.textContent=(100-pct)+"%";box.innerHTML='<div><b>'+esc(item.item_name)+'</b><div class="muted small">'+money(item.item_value)+' → '+esc(target.name)+' · '+money(target.value)+'</div></div><div class="chance-number">'+pct+'%</div>'}
window.upgrade=async()=>{if(!me)return authModal();if(rolling)return;const item=inventory.find(x=>x.id===upgradeSourceId),target=skins.find(x=>x.name===upgradeTarget);if(!item)return toast("Выбери предмет из инвентаря");if(!target)return toast("Выбери целевой скин");if(target.value<=item.item_value)return toast("Целевой скин должен быть дороже");rolling=true;try{
 const d=await api("/api/upgrade",{method:"POST",body:JSON.stringify({itemId:item.id,targetValue:target.value,targetName:target.name})});
 const dial=$("#upgrade-wheel-dial"),pointer=$("#upgrade-wheel-pointer"),status=$("#upgrade-spin-status");
 const chance=Math.max(0,Math.min(100,Number(d.chance)||0));
 const stopAngle=d.success?chance*3.6/2:chance*3.6+(360-chance*3.6)/2;
 if(dial)dial.style.setProperty("--chance",chance+"%");
 if($("#upgrade-wheel-value"))$("#upgrade-wheel-value").textContent=chance+"%";
 if($("#upgrade-wheel-caption"))$("#upgrade-wheel-caption").textContent=chance+"%";if($("#upgrade-success-percent"))$("#upgrade-success-percent").textContent=chance+"%";if($("#upgrade-fail-percent"))$("#upgrade-fail-percent").textContent=(100-chance)+"%";
 if(status)status.textContent="Стрелка вращается…";
 if(pointer){pointer.style.transition="transform 4.6s cubic-bezier(.08,.76,.12,1)";requestAnimationFrame(()=>{pointer.style.transform="rotate("+(360*6+stopAngle)+"deg)"})}
 await new Promise(resolve=>setTimeout(resolve,4700));
 openModal("РЕЗУЛЬТАТ АПГРЕЙДА",'<div class="win-result">'+skinArt(d.success?target.name:item.item_name)+'<p class="muted small">'+(d.success?"АПГРЕЙД УСПЕШЕН":"НЕ ПОВЕЗЛО")+'</p><h3>'+(d.success?esc(target.name):"Предмет потерян")+'</h3><strong>'+d.chance+'% шанс</strong><p class="muted small">'+esc(d.message)+'</p></div><button class="btn primary full-btn" onclick="closeModal()">Понятно</button>');
 selected.clear();await refresh()
 }catch(e){toast(e.message)}finally{rolling=false}};
function renderProfile(){const p=$("#profile-content");if(!p)return;if(!me){p.innerHTML='<p class="muted">Войди в аккаунт, чтобы увидеть профиль и инвентарь.</p>';$("#activity-list").innerHTML='<p class="muted small">История появится после входа.</p>';return}const total=inventory.reduce((s,x)=>s+Number(x.item_value),0);p.innerHTML='<div class="profile-head"><div class="avatar">'+esc(me.username.slice(0,2).toUpperCase())+'</div><div class="profile-main"><h3>'+esc(me.username)+(me.role==="owner"?' <span class="owner-tag">OWNER</span>':'')+'</h3><div class="profile-stats"><span class="stat-chip">Баланс <b>'+money(me.balance)+'</b></span><span class="stat-chip">Предметы <b>'+inventory.length+'</b></span><span class="stat-chip">Инвентарь <b>'+money(total)+'</b></span></div></div></div><div class="inventory-toolbar"><h3>Мой инвентарь</h3><span class="muted small">Выбери от 3 до 5 предметов для контракта</span></div><div class="inventory">'+(inventory.length?inventory.map(x=>skinCard(x.item_name,x.item_value,{market:true,select:true,sell:true,id:x.id})).join(""):'<p class="muted">Инвентарь пока пуст. Открой первый кейс!</p>')+'</div>';loadActivity()}
window.sellItem=async id=>{
 if(rolling)return;
 if(!confirm("Продать этот скин за его виртуальную стоимость?"))return;
 try{const d=await api("/api/inventory/"+id+"/sell",{method:"POST"});selected.delete(id);await refresh();toast("Скин продан. На баланс начислено "+money(d.sold))}catch(e){toast(e.message)}
};
window.toggleItem=(id,on)=>{on?selected.add(id):selected.delete(id);const count=selected.size;const hint=$(".inventory-toolbar .muted");if(hint)hint.textContent="Выбрано: "+count+" · для контракта нужно 3–5";renderUpgrade()};
async function loadActivity(){try{const rows=await api("/api/activity");$("#activity-list").innerHTML=rows.length?rows.map(a=>'<div class="activity-row"><span>'+esc(a.message)+'</span><time>'+new Date(a.created_at+"Z").toLocaleString("ru-RU",{dateStyle:"short",timeStyle:"short"})+'</time></div>').join(""):'<p class="muted small">Пока нет действий.</p>'}catch(e){$("#activity-list").innerHTML='<p class="muted small">История временно недоступна.</p>'}}
window.contract=async()=>{if(!me)return authModal();if(selected.size<3||selected.size>5)return toast("Выбери от 3 до 5 предметов");try{const d=await api("/api/contracts",{method:"POST",body:JSON.stringify({itemIds:[...selected]})});selected.clear();await refresh();toast(d.message)}catch(e){toast(e.message)}};
async function loadLeaders(){const rows=await api("/api/leaderboard");$("#leader-list").innerHTML=rows.length?rows.map((u,i)=>'<div class="rank"><b>#'+(i+1)+'</b><button class="player-link" onclick="viewPlayer(\''+esc(u.username)+'\')">'+esc(u.username)+(u.role==="owner"?' <span class="owner-tag">OWNER</span>':'')+'</button><b class="rank-value">'+money(u.balance+u.inventory_value)+'</b></div>').join(""):'Пока нет игроков'}
window.viewPlayer=async username=>{try{const d=await api("/api/users/"+encodeURIComponent(username));const u=d.user;openModal("ПРОФИЛЬ ИГРОКА",'<div class="profile-head"><div class="avatar">'+esc(u.username.slice(0,2).toUpperCase())+'</div><div><h3>'+esc(u.username)+(u.role==="owner"?' <span class="owner-tag">OWNER</span>':'')+'</h3><p class="muted small">В инвентаре '+d.inventory.length+' предметов · стоимость '+money(d.inventoryValue)+'</p></div></div><div class="public-inventory">'+(d.inventory.length?d.inventory.map(x=>skinCard(x.item_name,x.item_value,{market:true})).join(""):'<p class="muted">Инвентарь пуст</p>')+'</div>')}catch(e){toast(e.message)}};
async function loadBattles(){const bs=await api("/api/battles");$("#battle-list").innerHTML=bs.map(b=>'<div class="battle"><div><strong>'+esc(b.name)+'</strong><p class="muted small">'+b.players+' игрока · '+b.rounds+' раунда · '+esc(b.status)+'</p></div><div><b class="battle-price">'+money(b.entry)+'</b> <button class="btn primary" onclick="joinBattle('+b.id+','+b.entry+')">Участвовать</button></div></div>').join("")}
window.joinBattle=async(id,entry)=>{try{const d=await api("/api/battles/"+id+"/join",{method:"POST",body:JSON.stringify({entry})});await refresh();toast(d.message)}catch(e){toast(e.message)}};
async function loadStaff(search=""){
 const box=$("#staff-content");
 if(!box||!me||!["owner","admin","moderator"].includes(me.role))return;
 const q=String(search||"");
 box.innerHTML='<p class="muted">Загружаю список игроков…</p>';
 try{
  const d=await api("/api/staff/users?search="+encodeURIComponent(q));
  const users=d.users||[];
  const rows=users.map(u=>{
   const protectedOwner=u.role==="owner";
   const canAct=me.role==="owner" || (u.role==="user" && ["admin","moderator"].includes(me.role)) || (u.role==="moderator" && me.role==="owner");
   const actions=[];
   if(protectedOwner) actions.push('<span class="owner-shield">🛡 Защищён</span>');
   else {
    if(me.role!=="moderator" && canAct) actions.push('<button class="btn danger" onclick="staffAction('+u.id+',\\'ban\\')">Бан</button>');
    if(canAct) actions.push('<button class="btn secondary" onclick="staffAction('+u.id+',\\'kick\\')">Кик</button>');
    if(me.role==="owner" && u.banned) actions.push('<button class="btn secondary" onclick="staffAction('+u.id+',\\'unban\\')">Разбан</button>');
   }
   return '<div class="staff-row"><div><b>'+esc(u.username)+'</b><small>'+(protectedOwner?"🛡 OWNER":u.role==="admin"?"ADMIN":u.role==="moderator"?"MODERATOR":"Игрок")+(u.banned?" · ЗАБЛОКИРОВАН":"")+'</small></div><div class="staff-actions">'+actions.join("")+'</div></div>';
  });
  box.innerHTML='<div class="staff-toolbar"><div><b>Игроки сервера</b><small class="muted">Твоя роль: '+(me.role==="owner"?"Владелец":me.role==="admin"?"Администратор":"Модератор")+'</small></div><input id="staff-search" placeholder="Поиск по нику…" value="'+esc(q)+'" oninput="searchStaffUsers(this.value)"></div><div class="staff-list">'+(rows.length?rows.join(""):'<p class="muted">Игроки не найдены</p>')+'</div>';
 }catch(e){box.innerHTML='<p class="muted">'+esc(e.message)+'</p>'}
}
let staffSearchTimer=null;
window.searchStaffUsers=value=>{clearTimeout(staffSearchTimer);staffSearchTimer=setTimeout(()=>loadStaff(value),250)};
window.staffAction=async(id,action)=>{
 const label=action==="ban"?"заблокировать":action==="kick"?"отключить":"снять блокировку";
 if(!confirm("Ты действительно хочешь "+label+" этого игрока?"))return;
 try{const d=await api("/api/staff/users/"+id+"/action",{method:"POST",body:JSON.stringify({action})});toast(d.message);await loadStaff($("#staff-search")?.value||"")}
 catch(e){toast(e.message)}
};
async function loadOwner(search=ownerSearchQuery){
 ownerSearchQuery=String(search||'');
 const box=$("#owner-content");
 if(!me||me.role!=="owner"){box.innerHTML='<p class="muted">Доступ запрещён.</p>';return}
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
   '<div class="owner-toolbar"><div><h3>Управление игроками</h3><small class="muted">Выдача баланса и смена роли — отдельными действиями</small></div><div class="owner-toolbar-actions"><input id="owner-search" value="'+esc(ownerSearchQuery)+'" placeholder="Поиск по нику…" oninput="searchOwnerUsers(this.value)"><button class="btn secondary" onclick="loadOwner()">Обновить</button></div></div>'+
   '<div id="owner-users" class="owner-users">'+(users.length?users.map(u=>
    '<div class="user-row" data-user="'+esc(u.username.toLowerCase())+'">'+
     '<div class="user-info"><b>'+esc(u.username)+'</b> '+(u.role==="owner"?'<span class="owner-tag">OWNER</span>':'')+
     '<small>'+esc(u.role==="admin"?"Администратор":u.role==="moderator"?"Модератор":u.role==="owner"?"Владелец":"Игрок")+' · '+Number(u.item_count||0)+' предметов · инвентарь '+money(u.inventory_value)+'</small></div>'+
     '<div class="owner-field"><small>БАЛАНС · '+money(u.balance)+'</small><input id="bal-'+u.id+'" type="number" min="0" max="100000000" placeholder="Сумма" '+(u.role==="owner"&&Number(u.id)!==Number(me.id)?"disabled":"")+'></div>'+
     '<div class="owner-actions owner-balance-actions">'+
      '<button class="btn primary" onclick="ownerBalance('+u.id+',\'add\')" '+(u.role==="owner"&&Number(u.id)!==Number(me.id)?"disabled":"")+'>Выдать +</button>'+
      '<button class="btn secondary" onclick="ownerBalance('+u.id+',\'set\')" '+(u.role==="owner"&&Number(u.id)!==Number(me.id)?"disabled":"")+'>Задать</button>'+
     '</div>'+
     '<label class="owner-field"><small>РОЛЬ</small><select id="role-'+u.id+'" '+(u.role==="owner"?"disabled":"")+'><option value="user" '+(u.role==="user"?"selected":"")+'>Игрок</option><option value="admin" '+(u.role==="admin"?"selected":"")+'>Администратор</option></select></label>'+
     '<div class="owner-actions"><button class="btn secondary" onclick="ownerRole('+u.id+')" '+(u.role==="owner"?"disabled":"")+'>Сохранить роль</button>'+
     (u.role==="owner"?'':'<button class="btn danger" onclick="deleteUser('+u.id+',\''+esc(u.username)+'\')">Удалить</button>')+'</div></div>'
   ).join(""):'<p class="muted">'+(ownerSearchQuery?"По этому нику игроки не найдены.":"Пока нет игроков.")+'</p>')+'</div>'+
   '<div class="owner-activity"><h3>Последние действия</h3>'+
   (activity.length?activity.map(item=>'<p><b>'+esc(item.username||"Система")+'</b><span>'+esc(item.message)+'</span></p>').join(""):'<p class="muted">Действий пока нет.</p>')+
   '</div>';
 }catch(e){
  box.innerHTML='<p class="muted">Не удалось загрузить панель: '+esc(e.message)+'</p><button class="btn secondary" onclick="loadOwner()">Повторить</button>';
 }
}
window.loadOwner=loadOwner;
let ownerSearchQuery="";
let ownerSearchTimer=null;
window.searchOwnerUsers=value=>{ownerSearchQuery=String(value||"").trim();clearTimeout(ownerSearchTimer);ownerSearchTimer=setTimeout(()=>loadOwner(ownerSearchQuery),280)};
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
window.deleteUser=async(id,username)=>{
 if(!confirm("Удалить аккаунт "+username+" и весь его инвентарь?"))return;
 try{await api("/api/owner/users/"+id,{method:"DELETE"});await loadOwner();toast("Аккаунт удалён")}catch(e){toast(e.message)}
};
(async()=>{try{await loadSkins();await loadCases();await loadBattles();await loadLeaders();await refresh();const p=new URLSearchParams(location.search);if(p.get("chooseNick")==="1")nicknameModal();else if(p.has("google")){toast("Не удалось выполнить вход через Google");history.replaceState({},"",location.pathname)}}catch(e){toast(e.message)}})();