import { Router } from './router.js';
import { json } from './lib/http.js';
import { hashPassword, verifyPassword, isLegacyHash, hashToken } from './lib/crypto.js';

const DEFAULT_TEMP_PASSWORD = 'Mm123456';

const router = new Router();

const ok = (data={}) => json({ok:true,...data});
const uid = () => crypto.randomUUID();

async function audit(env, auth, action, entity, recordId=null, oldValue=null, newValue=null){
  await env.DB.prepare(`INSERT INTO audit_logs(tenant_id,actor_user_id,action,entity,record_id,old_value_json,new_value_json,ip,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(auth?.tenant?.id || null, auth?.user?.id || null, action, entity, recordId, oldValue?JSON.stringify(oldValue):null, newValue?JSON.stringify(newValue):null, null, null).run();
}

async function permissionsFor(env, userId){
  const r = await env.DB.prepare(`
    SELECT DISTINCT p.code, p.name_ar, p.domain, rp.scope_type, rp.scope_value
    FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
    JOIN user_roles ur ON ur.role_id=rp.role_id JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND r.enabled=1
    UNION
    SELECT p.code, p.name_ar, p.domain, upo.scope_type, upo.scope_value
    FROM user_permission_overrides upo JOIN permissions p ON p.id=upo.permission_id
    WHERE upo.user_id=? AND upo.effect='ALLOW'
  `).bind(userId,userId).all();
  return r.results || [];
}

async function requirePermission(auth, env, code){
  if (!auth) return false;
  const rows = await permissionsFor(env, auth.user.id);
  return rows.some(x=>x.code===code) || rows.some(x=>x.code==='*');
}

router.get('/api/health', async ({ env }) => {
  const row = await env.DB.prepare('SELECT 1 AS ok').first();
  return json({ ok: row?.ok === 1, database: 'D1', name: env.APP_NAME || 'HR Enterprise' });
});

router.post('/api/auth/login', async ({ request, env }) => {
  const body = await request.json();
  const companyIdentifier = String(body.companyIdentifier || '').trim();
  const userIdentifier = String(body.userIdentifier || '').trim();
  const password = String(body.password || '');
  if (!companyIdentifier || !userIdentifier || !password) return json({ error:'بيانات الدخول غير مكتملة' },400);
  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE company_identifier=? AND active=1').bind(companyIdentifier).first();
  if (!tenant) return json({ error:'بيانات الدخول غير صحيحة' },401);
  const user = await env.DB.prepare('SELECT * FROM users WHERE tenant_id=? AND user_identifier=?').bind(tenant.id,userIdentifier).first();
  if (!user || user.account_status!=='ACTIVE') return json({ error:'بيانات الدخول غير صحيحة' },401);
  if (!(await verifyPassword(password, user.password_hash))){
    await env.DB.prepare('INSERT INTO login_logs(tenant_id,user_id,success,ip,user_agent) VALUES(?,?,?,?,?)').bind(tenant.id,user.id,0,request.headers.get('CF-Connecting-IP'),request.headers.get('User-Agent')).run();
    return json({error:'بيانات الدخول غير صحيحة'},401);
  }
  // Transparently upgrade any pre-existing plain-SHA256 hash to salted PBKDF2 on successful login.
  if (isLegacyHash(user.password_hash)){
    await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(password), user.id).run();
  }
  const rawToken=crypto.randomUUID()+'.'+crypto.randomUUID();
  const sessionId=uid(); const expires=new Date(Date.now()+8*60*60*1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions(id,user_id,tenant_id,token_hash,expires_at) VALUES(?,?,?,?,?)').bind(sessionId,user.id,tenant.id,await hashToken(rawToken),expires),
    env.DB.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').bind(user.id),
    env.DB.prepare('INSERT INTO login_logs(tenant_id,user_id,success,ip,user_agent) VALUES(?,?,?,?,?)').bind(tenant.id,user.id,1,request.headers.get('CF-Connecting-IP'),request.headers.get('User-Agent'))
  ]);
  return json({token:rawToken,mustChangePassword:!!user.must_change_password,user:{id:user.id,identifier:user.user_identifier},tenant:{id:tenant.id,name:tenant.name_ar,identifier:tenant.company_identifier}});
});

router.post('/api/auth/logout', async ({ auth, env }) => { if(auth) await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?').bind(auth.session.id).run(); return ok(); });

router.post('/api/auth/change-password', async ({ auth, env, request }) => {
  const b = await request.json();
  const currentPassword = String(b.current_password || '');
  const newPassword = String(b.new_password || '');
  if (newPassword.length < 8) return json({ error:'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' },400);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(auth.user.id).first();
  if (!(await verifyPassword(currentPassword, user.password_hash))) return json({ error:'كلمة المرور الحالية غير صحيحة' },401);
  await env.DB.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').bind(await hashPassword(newPassword), auth.user.id).run();
  await audit(env, auth, 'UPDATE', 'users', auth.user.id, null, { action:'password_change' });
  return ok();
});

router.post('/api/admin/users/status', async ({ auth, env, request }) => {
  if (!(await requirePermission(auth,env,'users.manage'))) return json({error:'غير مصرح'},403);
  const b = await request.json();
  if (!b.user_id || !['ACTIVE','DISABLED'].includes(b.status)) return json({error:'بيانات غير صحيحة'},400);
  const before = await env.DB.prepare('SELECT account_status FROM users WHERE id=? AND tenant_id=?').bind(b.user_id,auth.tenant.id).first();
  if (!before) return json({error:'المستخدم غير موجود'},404);
  await env.DB.prepare('UPDATE users SET account_status=? WHERE id=? AND tenant_id=?').bind(b.status,b.user_id,auth.tenant.id).run();
  // Disabling login takes effect immediately — revoke any active sessions, not just future logins.
  if (b.status==='DISABLED') await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL').bind(b.user_id).run();
  await audit(env, auth, 'UPDATE', 'users', b.user_id, { account_status: before.account_status }, { account_status: b.status });
  return ok();
});

router.get('/api/me', async ({ auth, env }) => {
  const roles=await env.DB.prepare('SELECT r.code,r.name_ar,r.id FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.enabled=1').bind(auth.user.id).all();
  const permissions=await permissionsFor(env,auth.user.id);
  return json({user:auth.user,tenant:auth.tenant,roles:roles.results,permissions});
});

router.get('/api/dashboard', async ({auth,env})=>{
  const [employees,pending,nodes,users,trxTypes]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) c FROM employees WHERE tenant_id=? AND employee_status<>?').bind(auth.tenant.id,'إنهاء').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM transactions WHERE tenant_id=? AND status=?').bind(auth.tenant.id,'قيد الإجراء').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM organization_nodes WHERE tenant_id=? AND active=1').bind(auth.tenant.id).first(),
    env.DB.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id=?').bind(auth.tenant.id).first(),
    env.DB.prepare('SELECT COUNT(*) c FROM transaction_types WHERE tenant_id=? AND enabled=1').bind(auth.tenant.id).first()
  ]);
  return json({cards:{employees:employees?.c||0,pendingTransactions:pending?.c||0,organizationNodes:nodes?.c||0,users:users?.c||0,transactionTypes:trxTypes?.c||0}});
});

router.get('/api/employees', async ({auth,env,url})=>{
  const q=url.searchParams.get('q')?.trim()||'';
  if(!(await requirePermission(auth,env,'employees.view'))) return json({error:'لا تملك صلاحية عرض الموظفين'},403);
  const rows=await env.DB.prepare(`SELECT e.id,e.employee_number,e.first_name,e.father_name,e.family_name,e.id_number,e.job_title,e.employee_status,e.join_date,p.title_ar position_name,o.name_ar organization_name FROM employees e LEFT JOIN organization_nodes o ON o.id=e.organization_node_id AND o.tenant_id=e.tenant_id LEFT JOIN positions p ON p.id=e.position_id AND p.tenant_id=e.tenant_id WHERE e.tenant_id=? AND (?='' OR e.employee_number=? OR e.id_number=? OR (e.first_name||' '||COALESCE(e.family_name,'')) LIKE ?) ORDER BY e.employee_number LIMIT 200`).bind(auth.tenant.id,q,q,q,`%${q}%`).all();
  return json({results:rows.results});
});

router.get('/api/organization/tree', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'organization.view'))) return json({error:'لا تملك صلاحية عرض الهيكل التنظيمي'},403);
  const nodes=await env.DB.prepare('SELECT * FROM organization_nodes WHERE tenant_id=? AND active=1 ORDER BY parent_id,sort_order,name_ar').bind(auth.tenant.id).all(); return json({results:nodes.results});
});

router.post('/api/organization/nodes', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'organization.manage'))) return json({error:'لا تملك صلاحية إدارة الهيكل التنظيمي'},403);
  const b=await request.json(); if(!b.name_ar||!b.node_type) return json({error:'اسم الوحدة ونوعها مطلوبان'},400);
  const id=uid(); await env.DB.prepare('INSERT INTO organization_nodes(id,tenant_id,parent_id,name_ar,name_en,node_type,sort_order,active) VALUES(?,?,?,?,?,?,?,1)').bind(id,auth.tenant.id,b.parent_id||null,b.name_ar,b.name_en||null,b.node_type,Number(b.sort_order||0)).run(); await audit(env,auth,'CREATE','organization_nodes',id,null,b); return ok({id});
});

router.get('/api/transactions', async ({auth,env,url})=>{
  if(!(await requirePermission(auth,env,'transactions.view'))) return json({error:'لا تملك صلاحية عرض المعاملات'},403);
  const number=url.searchParams.get('number')?.trim()||''; if(!number) return json({error:'أدخل رقم المعاملة'},400);
  const row=await env.DB.prepare('SELECT t.*,tt.name_ar transaction_type_name FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id WHERE t.tenant_id=? AND t.transaction_number=?').bind(auth.tenant.id,Number(number)).first(); return json({result:row||null});
});

// Administration: companies, users, roles, permissions, audit
router.get('/api/admin/summary', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const [companies,users,roles,permissions]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) c FROM tenants').first(),env.DB.prepare('SELECT COUNT(*) c FROM users WHERE tenant_id=?').bind(auth.tenant.id).first(),env.DB.prepare('SELECT COUNT(*) c FROM roles WHERE tenant_id=? OR tenant_id IS NULL').bind(auth.tenant.id).first(),env.DB.prepare('SELECT COUNT(*) c FROM permissions').first()
  ]); return json({companies:companies?.c||0,users:users?.c||0,roles:roles?.c||0,permissions:permissions?.c||0});
});

router.get('/api/admin/companies', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare('SELECT id,company_identifier,name_ar,name_en,active,created_at FROM tenants ORDER BY name_ar').all(); return json({results:r.results});
});
router.post('/api/admin/companies', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const b=await request.json(); if(!b.company_identifier||!b.name_ar) return json({error:'معرف الشركة والاسم العربي مطلوبان'},400);
  const id=uid(); await env.DB.prepare('INSERT INTO tenants(id,company_identifier,name_ar,name_en,active) VALUES(?,?,?,?,1)').bind(id,b.company_identifier.trim(),b.name_ar,b.name_en||null).run(); await env.DB.prepare('INSERT INTO company_settings(tenant_id,settings_json) VALUES(?,?)').bind(id,'{"language":"ar","timezone":"Asia/Riyadh"}').run(); await audit(env,auth,'CREATE','tenants',id,null,b); return ok({id});
});

router.get('/api/admin/roles', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare(`SELECT r.id,r.code,r.name_ar,r.enabled,r.system_role,COUNT(rp.permission_id) permission_count FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id WHERE r.tenant_id=? OR r.tenant_id IS NULL GROUP BY r.id ORDER BY r.system_role DESC,r.name_ar`).bind(auth.tenant.id).all(); return json({results:r.results});
});
router.post('/api/admin/roles', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const b=await request.json(); if(!b.code||!b.name_ar) return json({error:'رمز الدور واسم الدور مطلوبان'},400); const id=uid(); await env.DB.prepare('INSERT INTO roles(id,tenant_id,code,name_ar,system_role,enabled) VALUES(?,?,?,?,0,1)').bind(id,auth.tenant.id,b.code,b.name_ar).run(); await audit(env,auth,'CREATE','roles',id,null,b); return ok({id});
});
router.get('/api/admin/permissions', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare('SELECT id,code,name_ar,domain FROM permissions ORDER BY domain,code').all(); return json({results:r.results});
});
router.get('/api/admin/role-permissions', async ({auth,env,url})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403); const roleId=url.searchParams.get('role_id'); if(!roleId) return json({error:'role_id مطلوب'},400);
  const r=await env.DB.prepare('SELECT rp.permission_id,rp.scope_type,rp.scope_value,p.code,p.name_ar,p.domain FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? ORDER BY p.domain,p.code').bind(roleId).all(); return json({results:r.results});
});
router.post('/api/admin/role-permissions', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403); const b=await request.json(); if(!b.role_id||!b.permission_id) return json({error:'الدور والصلاحية مطلوبان'},400);
  await env.DB.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope_type,scope_value) VALUES(?,?,?,?)').bind(b.role_id,b.permission_id,b.scope_type||'COMPANY',b.scope_value||null).run(); await audit(env,auth,'GRANT','role_permissions',`${b.role_id}:${b.permission_id}`,null,b); return ok();
});
router.post('/api/admin/role-permissions/remove', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403); const b=await request.json(); await env.DB.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=? AND scope_type=? AND COALESCE(scope_value,\'\')=COALESCE(?,\'\')').bind(b.role_id,b.permission_id,b.scope_type||'COMPANY',b.scope_value||null).run(); return ok();
});

router.get('/api/admin/users', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'users.manage'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare(`SELECT u.id,u.user_identifier,u.account_status,u.must_change_password,u.last_login_at,GROUP_CONCAT(r.name_ar,'، ') roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.tenant_id=? GROUP BY u.id ORDER BY u.user_identifier`).bind(auth.tenant.id).all(); return json({results:r.results});
});
router.post('/api/admin/users', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'users.manage'))) return json({error:'غير مصرح'},403); const b=await request.json(); if(!b.user_identifier||!b.password||!b.role_id) return json({error:'رقم المستخدم وكلمة المرور والدور مطلوبة'},400);
  const id=uid(); await env.DB.prepare('INSERT INTO users(id,tenant_id,user_identifier,password_hash,account_status,must_change_password) VALUES(?,?,?,?,\'ACTIVE\',1)').bind(id,auth.tenant.id,b.user_identifier,await hashPassword(b.password)).run(); await env.DB.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').bind(id,b.role_id).run(); await audit(env,auth,'CREATE','users',id,null,{user_identifier:b.user_identifier,role_id:b.role_id}); return ok({id});
});

router.get('/api/admin/transactions/types', async ({auth,env})=>{ if(!(await requirePermission(auth,env,'transactions.create'))) return json({error:'غير مصرح'},403); const r=await env.DB.prepare('SELECT * FROM transaction_types WHERE tenant_id=? ORDER BY name_ar').bind(auth.tenant.id).all(); return json({results:r.results}); });
router.post('/api/admin/transactions/types', async ({auth,env,request})=>{ if(!(await requirePermission(auth,env,'transactions.create'))) return json({error:'غير مصرح'},403); const b=await request.json(); if(!b.name_ar||!b.code) return json({error:'اسم ورمز المعاملة مطلوبان'},400); const id=uid(); await env.DB.prepare('INSERT INTO transaction_types(id,tenant_id,name_ar,code,enabled,config_json) VALUES(?,?,?,?,1,?)').bind(id,auth.tenant.id,b.name_ar,b.code,JSON.stringify(b.config||{})).run(); await audit(env,auth,'CREATE','transaction_types',id,null,b); return ok({id}); });

router.get('/api/admin/workflows', async ({auth,env})=>{ if(!(await requirePermission(auth,env,'workflows.view'))) return json({error:'غير مصرح'},403); const r=await env.DB.prepare(`SELECT w.id,w.name_ar,w.version,w.enabled,t.name_ar transaction_type_name,COUNT(s.id) stage_count FROM workflow_definitions w LEFT JOIN transaction_types t ON t.id=w.transaction_type_id LEFT JOIN workflow_stages s ON s.workflow_id=w.id WHERE w.tenant_id=? GROUP BY w.id ORDER BY w.created_at DESC`).bind(auth.tenant.id).all(); return json({results:r.results}); });
router.post('/api/admin/workflows', async ({auth,env,request})=>{ if(!(await requirePermission(auth,env,'workflows.manage'))) return json({error:'غير مصرح'},403); const b=await request.json(); if(!b.name_ar||!b.transaction_type_id) return json({error:'اسم المسار ونوع المعاملة مطلوبان'},400); const id=uid(); await env.DB.prepare('INSERT INTO workflow_definitions(id,tenant_id,transaction_type_id,name_ar,version,enabled,config_json) VALUES(?,?,?, ?,1,1,?)').bind(id,auth.tenant.id,b.transaction_type_id,b.name_ar,JSON.stringify({})).run(); const stages=Array.isArray(b.stages)?b.stages:[]; for(let i=0;i<stages.length;i++){const s=stages[i]; await env.DB.prepare('INSERT INTO workflow_stages(id,workflow_id,name_ar,stage_order,owner_type,owner_config_json,duration_minutes,actions_json,questions_json,feedback_config_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(uid(),id,s.name_ar,i+1,s.owner_type||'ROLE',JSON.stringify(s.owner_config||{}),s.duration_minutes||null,JSON.stringify(s.actions||[]),JSON.stringify(s.questions||[]),JSON.stringify({})).run();} await audit(env,auth,'CREATE','workflow_definitions',id,null,b); return ok({id}); });


// ---------- Operational HR endpoints ----------
router.post('/api/employees', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'employees.create'))) return json({error:'لا تملك صلاحية إنشاء موظف'},403);
  const b=await request.json();
  if(!b.employee_number||!b.first_name||!b.identity_type||!b.id_number||!b.join_date) return json({error:'الرقم الوظيفي والاسم ونوع الهوية ورقم الهوية وتاريخ المباشرة مطلوبة'},400);
  const id=uid();
  try{
    await env.DB.prepare(`INSERT INTO employees(
      id,tenant_id,identity_key,employee_number,first_name,father_name,grandfather_name,family_name,
      english_name,gender,birth_date,nationality,marital_status,identity_type,id_number,id_expiry_date,
      mobile,email,short_address,join_date,job_title,position_id,organization_node_id,direct_manager_id,
      employee_status,bank_name,iban,general_notes
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id,auth.tenant.id,b.identity_key||b.id_number,b.employee_number,b.first_name,b.father_name||null,b.grandfather_name||null,
      b.family_name||null,b.english_name||null,b.gender||null,b.birth_date||null,b.nationality||'سعودي',b.marital_status||null,
      b.identity_type,b.id_number,b.id_expiry_date||null,b.mobile||null,b.email||null,b.short_address||null,b.join_date,
      b.job_title||null,b.position_id||null,b.organization_node_id||null,b.direct_manager_id||null,b.employee_status||'نشط',
      b.bank_name||null,b.iban||null,b.general_notes||null
    ).run();
    const basic=Number(b.basic_salary||0), housing=Number(b.housing_allowance||0), transport=Number(b.transport_allowance||0);
    const comps=[];
    if(basic>0) comps.push(['BASIC','الراتب الأساسي','FIXED',basic]);
    if(housing>0) comps.push(['ALLOWANCE','بدل السكن','FIXED',housing]);
    if(transport>0) comps.push(['ALLOWANCE','بدل النقل','FIXED',transport]);
    for(const c of comps) await env.DB.prepare(`INSERT INTO salary_components(id,tenant_id,employee_id,component_type,name_ar,method,value,effective_date,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(uid(),auth.tenant.id,id,c[0],c[1],c[2],c[3],b.join_date).run();
    if(b.gosi_deduct==='1' || b.gosi_deduct===true){
      await env.DB.prepare(`INSERT OR REPLACE INTO insurance(id,tenant_id,employee_id,subscriber_number,contribution_status,contribution_rule,employee_rate,employer_rate) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(uid(),auth.tenant.id,id,b.gosi_number||null,'ACTIVE','BASIC',Number(b.gosi_rate||9.75),Number(b.employer_rate||0)).run();
    }
    await env.DB.prepare(`INSERT INTO employee_history(tenant_id,employee_id,event_type,event_date,payload_json) VALUES(?,?,?,?,?)`)
      .bind(auth.tenant.id,id,'CREATED',b.join_date,JSON.stringify({source:'employee_creation'})).run();

    // Auto-provision the login account: username is always the ID number, with a forced
    // temporary password. If an account for this identity already exists (rehire — same
    // national ID, new employee number), reactivate it instead of creating a duplicate.
    const tempHash = await hashPassword(DEFAULT_TEMP_PASSWORD);
    const existingUser = await env.DB.prepare('SELECT id,account_status FROM users WHERE tenant_id=? AND user_identifier=?').bind(auth.tenant.id, b.id_number).first();
    if (existingUser) {
      await env.DB.prepare('UPDATE users SET account_status=\'ACTIVE\', must_change_password=1, password_hash=?, employee_id=? WHERE id=?').bind(tempHash, id, existingUser.id).run();
      await audit(env,auth,'REACTIVATE','users',existingUser.id,{account_status:existingUser.account_status},{account_status:'ACTIVE',employee_id:id});
    } else {
      const userId=uid();
      await env.DB.prepare('INSERT INTO users(id,tenant_id,employee_id,user_identifier,password_hash,account_status,must_change_password) VALUES(?,?,?,?,?,\'ACTIVE\',1)')
        .bind(userId,auth.tenant.id,id,b.id_number,tempHash).run();
      await audit(env,auth,'CREATE','users',userId,null,{user_identifier:b.id_number,employee_id:id,source:'employee_creation'});
    }

    await audit(env,auth,'CREATE','employees',id,null,b);
    return ok({id});
  }catch(e){ return json({error:e?.message?.includes('UNIQUE')?'الرقم الوظيفي أو رقم الهوية مستخدم مسبقًا':e?.message||'تعذر إنشاء الموظف'},400); }
});

router.get('/api/positions', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'organization.view'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare(`SELECT p.*,o.name_ar organization_name FROM positions p LEFT JOIN organization_nodes o ON o.id=p.organization_node_id WHERE p.tenant_id=? AND p.active=1 ORDER BY p.title_ar`).bind(auth.tenant.id).all();
  return json({results:r.results});
});
router.post('/api/positions', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'organization.manage'))) return json({error:'غير مصرح'},403);
  const b=await request.json(); if(!b.title_ar) return json({error:'مسمى الوظيفة مطلوب'},400);
  const id=uid(); await env.DB.prepare(`INSERT INTO positions(id,tenant_id,organization_node_id,title_ar,title_en,code,active) VALUES(?,?,?,?,?,?,1)`)
    .bind(id,auth.tenant.id,b.organization_node_id||null,b.title_ar,b.title_en||null,b.code||null).run();
  await audit(env,auth,'CREATE','positions',id,null,b); return ok({id});
});

router.get('/api/transactions/list', async ({auth,env,url})=>{
  if(!(await requirePermission(auth,env,'transactions.view'))) return json({error:'غير مصرح'},403);
  const status=url.searchParams.get('status')||'';
  const r=await env.DB.prepare(`SELECT t.id,t.transaction_number,t.status,t.created_at,tt.name_ar transaction_type_name,
    e.employee_number,e.first_name,e.family_name,w.name_ar workflow_name,s.name_ar stage_name
    FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id
    LEFT JOIN employees e ON e.id=t.employee_id
    LEFT JOIN workflow_definitions w ON w.id=t.workflow_id
    LEFT JOIN workflow_stages s ON s.id=t.current_stage_id
    WHERE t.tenant_id=? AND (?='' OR t.status=?) ORDER BY t.created_at DESC LIMIT 300`)
    .bind(auth.tenant.id,status,status).all();
  return json({results:r.results});
});

router.post('/api/transactions/create', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'transactions.create'))) return json({error:'لا تملك صلاحية إنشاء المعاملة'},403);
  const b=await request.json();
  if(!b.transaction_type_id) return json({error:'نوع المعاملة مطلوب'},400);
  const type=await env.DB.prepare('SELECT * FROM transaction_types WHERE id=? AND tenant_id=? AND enabled=1').bind(b.transaction_type_id,auth.tenant.id).first();
  if(!type) return json({error:'نوع المعاملة غير موجود أو متوقف'},404);
  const wf=await env.DB.prepare('SELECT * FROM workflow_definitions WHERE transaction_type_id=? AND tenant_id=? AND enabled=1 ORDER BY version DESC LIMIT 1').bind(type.id,auth.tenant.id).first();
  if(!wf) return json({error:'لا يوجد مسار عمل فعال لهذا النوع من المعاملات'},400);
  const stages=await env.DB.prepare('SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY stage_order').bind(wf.id).all();
  const first=stages.results?.[0];
  const seq=await env.DB.prepare('SELECT last_number FROM transaction_sequences WHERE tenant_id=?').bind(auth.tenant.id).first();
  const number=Number(seq?.last_number||0)+1;
  const txid=uid();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO transaction_sequences(tenant_id,last_number) VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET last_number=excluded.last_number`).bind(auth.tenant.id,number),
    env.DB.prepare(`INSERT INTO transactions(id,tenant_id,transaction_number,transaction_type_id,workflow_id,employee_id,created_by,status,current_stage_id,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(txid,auth.tenant.id,number,type.id,wf.id,b.employee_id||null,auth.user.id,first?'قيد الإجراء':'مكتملة',first?.id||null,JSON.stringify(b.payload||{}))
  ]);
  if(first) await env.DB.prepare(`INSERT INTO transaction_stage_instances(id,transaction_id,stage_id,round_number,owner_user_id,status) VALUES(?,?,?,?,?,?)`)
    .bind(uid(),txid,first.id,1,first.owner_type==='USER'?auth.user.id:null,'PENDING').run();
  await audit(env,auth,'CREATE','transactions',txid,null,b);
  return ok({id:txid,transaction_number:number,status:first?'قيد الإجراء':'مكتملة'});
});

router.get('/api/payroll/runs', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'payroll.view'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare(`SELECT pr.*,COUNT(pi.id) employee_count,COALESCE(SUM(pi.gross),0) gross_total,COALESCE(SUM(pi.total_deductions),0) deductions_total,COALESCE(SUM(pi.net),0) net_total
    FROM payroll_runs pr LEFT JOIN payroll_items pi ON pi.payroll_run_id=pr.id WHERE pr.tenant_id=? GROUP BY pr.id ORDER BY pr.payroll_month DESC`).bind(auth.tenant.id).all();
  return json({results:r.results});
});
router.post('/api/payroll/runs', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'payroll.run'))) return json({error:'لا تملك صلاحية تشغيل الرواتب'},403);
  const b=await request.json(); if(!b.payroll_month) return json({error:'شهر الرواتب مطلوب'},400);
  const existing=await env.DB.prepare('SELECT id FROM payroll_runs WHERE tenant_id=? AND payroll_month=?').bind(auth.tenant.id,b.payroll_month).first();
  if(existing) return json({error:'دورة الرواتب موجودة مسبقًا',id:existing.id},409);
  const id=uid(); await env.DB.prepare(`INSERT INTO payroll_runs(id,tenant_id,payroll_month,status,created_by) VALUES(?,?,?,?,?)`).bind(id,auth.tenant.id,b.payroll_month,'OPEN',auth.user.id).run();
  return ok({id});
});
router.post('/api/payroll/runs/calculate', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'payroll.run'))) return json({error:'لا تملك صلاحية تشغيل الرواتب'},403);
  const b=await request.json(); const run=await env.DB.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').bind(b.run_id,auth.tenant.id).first();
  if(!run) return json({error:'دورة الرواتب غير موجودة'},404);
  const employees=await env.DB.prepare(`SELECT * FROM employees WHERE tenant_id=? AND employee_status='نشط' ORDER BY employee_number`).bind(auth.tenant.id).all();
  await env.DB.prepare('DELETE FROM payroll_items WHERE payroll_run_id=?').bind(run.id).run();
  for(const e of employees.results){
    const comps=await env.DB.prepare(`SELECT * FROM salary_components WHERE tenant_id=? AND employee_id=? AND active=1 AND effective_date<=? ORDER BY effective_date DESC`).bind(auth.tenant.id,e.id,run.payroll_month+'-31').all();
    let basic=0,gross=0,deductions=0;
    const detail=[];
    for(const c of comps.results){
      const amount=c.method==='PERCENTAGE' ? (basic*c.value/100) : Number(c.value||0);
      if(c.component_type==='DEDUCTION') deductions+=amount;
      else { gross+=amount; if(c.component_type==='BASIC') basic+=amount; }
      detail.push({name:c.name_ar,type:c.component_type,amount});
    }
    const ins=await env.DB.prepare(`SELECT * FROM insurance WHERE tenant_id=? AND employee_id=?`).bind(auth.tenant.id,e.id).first();
    let gosi=0;
    if(ins?.contribution_status==='ACTIVE') gosi=basic*Number(ins.employee_rate||0)/100;
    deductions+=gosi;
    const adds=await env.DB.prepare(`SELECT * FROM additions WHERE tenant_id=? AND employee_id=? AND status='Active'`).bind(auth.tenant.id,e.id).all();
    for(const a of adds.results){gross+=Number(a.amount||0); detail.push({name:a.type,type:'ADDITION',amount:Number(a.amount||0)})}
    const dels=await env.DB.prepare(`SELECT * FROM deductions WHERE tenant_id=? AND employee_id=? AND status='Active'`).bind(auth.tenant.id,e.id).all();
    for(const d of dels.results){deductions+=Number(d.amount||0); detail.push({name:d.type,type:'DEDUCTION',amount:Number(d.amount||0)})}
    const net=gross-deductions;
    await env.DB.prepare(`INSERT INTO payroll_items(id,payroll_run_id,tenant_id,employee_id,basic_salary,gross,total_deductions,net,calculation_json) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(uid(),run.id,auth.tenant.id,e.id,basic,gross,deductions,net,JSON.stringify({components:detail,gosi})).run();
  }
  await env.DB.prepare(`UPDATE payroll_runs SET calculated_at=CURRENT_TIMESTAMP,status='CALCULATED' WHERE id=?`).bind(run.id).run();
  await audit(env,auth,'CALCULATE','payroll_runs',run.id,null,{payroll_month:run.payroll_month});
  return ok();
});
router.get('/api/payroll/runs/items', async ({auth,env,url})=>{
  if(!(await requirePermission(auth,env,'payroll.view'))) return json({error:'غير مصرح'},403);
  const runId=url.searchParams.get('run_id'); if(!runId) return json({error:'run_id مطلوب'},400);
  const r=await env.DB.prepare(`SELECT pi.*,e.employee_number,e.first_name,e.family_name FROM payroll_items pi JOIN employees e ON e.id=pi.employee_id WHERE pi.payroll_run_id=? AND pi.tenant_id=? ORDER BY e.employee_number`).bind(runId,auth.tenant.id).all();
  return json({results:r.results});
});

router.get('/api/reports/overview', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'reports.view'))) return json({error:'غير مصرح'},403);
  const [emp,org,tx,openPayroll,users]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) c FROM employees WHERE tenant_id=? AND employee_status='نشط'`).bind(auth.tenant.id).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM organization_nodes WHERE tenant_id=? AND active=1`).bind(auth.tenant.id).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM transactions WHERE tenant_id=?`).bind(auth.tenant.id).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM payroll_runs WHERE tenant_id=? AND status IN ('OPEN','CALCULATED')`).bind(auth.tenant.id).first(),
    env.DB.prepare(`SELECT COUNT(*) c FROM users WHERE tenant_id=? AND account_status='ACTIVE'`).bind(auth.tenant.id).first()
  ]);
  return json({employees:emp?.c||0,organization:org?.c||0,transactions:tx?.c||0,openPayroll:openPayroll?.c||0,users:users?.c||0});
});

router.post('/api/admin/settings', async ({auth,env,request})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const b=await request.json();
  await env.DB.prepare(`INSERT INTO company_settings(tenant_id,settings_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=CURRENT_TIMESTAMP`)
    .bind(auth.tenant.id,JSON.stringify(b||{})).run();
  await audit(env,auth,'UPDATE','company_settings',auth.tenant.id,null,b);
  return ok();
});
router.get('/api/admin/settings', async ({auth,env})=>{
  if(!(await requirePermission(auth,env,'roles.manage'))) return json({error:'غير مصرح'},403);
  const r=await env.DB.prepare('SELECT settings_json FROM company_settings WHERE tenant_id=?').bind(auth.tenant.id).first();
  let settings={}; try{settings=JSON.parse(r?.settings_json||'{}')}catch{}
  return json({settings});
});

router.get('/api/admin/audit', async ({auth,env})=>{ if(!(await requirePermission(auth,env,'audit.view'))) return json({error:'غير مصرح'},403); const r=await env.DB.prepare(`SELECT a.created_at,a.action,a.entity,a.record_id,u.user_identifier FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 200`).bind(auth.tenant.id).all(); return json({results:r.results}); });

export default { async fetch(request,env,ctx){ return router.handle(request,env,ctx); } };
