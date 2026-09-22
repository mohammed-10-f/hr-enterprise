
const state = { token: localStorage.getItem('hr_token'), me:null };

const $ = id => document.getElementById(id);
async function api(path, options={}) {
  const headers = {'content-type':'application/json', ...(options.headers||{})};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path,{...options,headers});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'تعذر تنفيذ العملية');
  return data;
}

async function boot(){
  if(!state.token){showLogin();return;}
  try{
    state.me=await api('/api/me');
    showShell();
    loadPage('dashboard');
  }catch(e){localStorage.removeItem('hr_token');state.token=null;showLogin();}
}

function showLogin(){
  $('login').classList.remove('hidden');$('shell').classList.add('hidden');
}
function showShell(){
  $('login').classList.add('hidden');$('shell').classList.remove('hidden');
  $('tenantName').textContent=state.me.tenant.name;
  $('userBadge').textContent=state.me.user.identifier;
}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('loginError').textContent='';
  try{
    const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify({
      companyIdentifier:$('companyIdentifier').value,
      userIdentifier:$('userIdentifier').value,
      password:$('password').value
    })});
    state.token=r.token;localStorage.setItem('hr_token',r.token);
    state.me=await api('/api/me');showShell();loadPage('dashboard');
  }catch(err){$('loginError').textContent=err.message;}
});
$('logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'})}finally{localStorage.removeItem('hr_token');location.reload()}};

document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>loadPage(b.dataset.page));

async function loadPage(page){
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  const titles={dashboard:'لوحة التحكم',employees:'الموظفون',organization:'الهيكل التنظيمي',transactions:'المعاملات',payroll:'الرواتب',reports:'التقارير',administration:'الإدارة'};
  $('pageTitle').textContent=titles[page]||'';
  const handlers={dashboard:dashboard,employees:employees,organization:organization,transactions:transactions,payroll:placeholder,reports:placeholder,administration:placeholder};
  try{await handlers[page]()}catch(e){$('content').innerHTML=`<div class="card error">${e.message}</div>`}
}

async function dashboard(){
  const d=await api('/api/dashboard');
  $('content').innerHTML=`
    <div class="grid">
      <div class="card"><div class="label">الموظفون</div><div class="value">${d.cards.employees}</div></div>
      <div class="card"><div class="label">المعاملات قيد الإجراء</div><div class="value">${d.cards.pendingTransactions}</div></div>
      <div class="card"><div class="label">الوحدات التنظيمية</div><div class="value">${d.cards.organizationNodes}</div></div>
      <div class="card"><div class="label">حالة النظام</div><div class="value">نشط</div></div>
    </div>
    <div class="section"><h2>مساحة العمل</h2><div class="card">لوحة التحكم تعرض فقط مؤشرات مسموحة للمستخدم. الوظائف التشغيلية موجودة داخل صفحاتها وليست داخل Dashboard.</div></div>`;
}

async function employees(){
  $('content').innerHTML=`<div class="toolbar"><input id="empQ" placeholder="بحث برقم الموظف أو الهوية أو الاسم"><button id="empSearch">بحث</button></div><div class="table-wrap"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>الهوية</th><th>الوظيفة</th><th>الحالة</th><th>المباشرة</th></tr></thead><tbody id="empRows"></tbody></table></div>`;
  const run=async()=>{const d=await api('/api/employees?q='+encodeURIComponent($('empQ').value));$('empRows').innerHTML=d.results.map(e=>`<tr><td>${e.employee_number}</td><td>${[e.first_name,e.father_name,e.family_name].filter(Boolean).join(' ')}</td><td>${e.id_number}</td><td>${e.position_name||e.job_title||'-'}</td><td><span class="badge">${e.employee_status}</span></td><td>${e.join_date}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد بيانات</td></tr>'};
  $('empSearch').onclick=run; await run();
}

async function organization(){
  const d=await api('/api/organization/tree');
  const map=new Map(d.results.map(n=>[n.id,{...n,children:[]}]));
  d.results.forEach(n=>{if(n.parent_id&&map.has(n.parent_id))map.get(n.parent_id).children.push(map.get(n.id))});
  const roots=d.results.filter(n=>!n.parent_id).map(n=>map.get(n.id));
  const render=n=>`<div class="node"><strong>${n.name_ar}</strong> <span class="badge">${n.node_type}</span>${n.children.map(c=>`<div class="child">${render(c)}</div>`).join('')}</div>`;
  $('content').innerHTML=`<div class="card"><h2>الهيكل التنظيمي</h2><div class="tree">${roots.map(render).join('')||'لا توجد وحدات تنظيمية بعد'}</div></div>`;
}

async function transactions(){
  $('content').innerHTML=`<div class="toolbar"><input id="trxNo" inputmode="numeric" placeholder="رقم المعاملة فقط"><button id="trxSearch">بحث</button></div><div id="trxResult"></div>`;
  $('trxSearch').onclick=async()=>{try{const d=await api('/api/transactions?number='+encodeURIComponent($('trxNo').value));$('trxResult').innerHTML=d.result?`<div class="card"><h2>معاملة رقم ${d.result.transaction_number}</h2><p>النوع: ${d.result.transaction_type_name}</p><p>الحالة: <span class="badge">${d.result.status}</span></p></div>`:'<div class="card">لم يتم العثور على المعاملة</div>'}catch(e){$('trxResult').innerHTML=`<div class="card error">${e.message}</div>`}};
}

async function placeholder(){
  $('content').innerHTML=`<div class="card"><h2>الوحدة ضمن البنية الجديدة</h2><p>تم إنشاء قاعدة البيانات والحدود المعمارية لهذه الوحدة. لن يتم وضع شاشة وهمية أو وظيفة Mock مكان منطق الأعمال الحقيقي.</p></div>`;
}
boot();
