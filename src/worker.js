
import { Router } from './router.js';
import { json } from './lib/http.js';
import { hashPassword } from './lib/crypto.js';

const router = new Router();

router.get('/api/health', async ({ env }) => {
  const row = await env.DB.prepare('SELECT 1 AS ok').first();
  return json({ ok: row?.ok === 1, database: 'D1', name: env.APP_NAME || 'HR Enterprise' });
});

router.post('/api/auth/login', async ({ request, env }) => {
  const body = await request.json();
  const companyIdentifier = String(body.companyIdentifier || '').trim();
  const userIdentifier = String(body.userIdentifier || '').trim();
  const password = String(body.password || '');

  if (!companyIdentifier || !userIdentifier || !password) {
    return json({ error: 'بيانات الدخول غير مكتملة' }, 400);
  }

  const tenant = await env.DB.prepare(
    'SELECT * FROM tenants WHERE company_identifier = ? AND active = 1'
  ).bind(companyIdentifier).first();

  if (!tenant) return json({ error: 'بيانات الدخول غير صحيحة' }, 401);

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE tenant_id = ? AND user_identifier = ?'
  ).bind(tenant.id, userIdentifier).first();

  if (!user || user.account_status !== 'ACTIVE') {
    return json({ error: 'بيانات الدخول غير صحيحة' }, 401);
  }

  const supplied = await hashPassword(password);
  if (supplied !== user.password_hash) {
    await env.DB.prepare(
      'INSERT INTO login_logs(tenant_id,user_id,success,ip,user_agent) VALUES(?,?,?,?,?)'
    ).bind(tenant.id, user.id, 0, request.headers.get('CF-Connecting-IP'), request.headers.get('User-Agent')).run();
    return json({ error: 'بيانات الدخول غير صحيحة' }, 401);
  }

  const rawToken = crypto.randomUUID() + '.' + crypto.randomUUID();
  const tokenHash = await hashPassword(rawToken);
  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sessions(id,user_id,tenant_id,token_hash,expires_at) VALUES(?,?,?,?,?)'
    ).bind(sessionId, user.id, tenant.id, tokenHash, expires),
    env.DB.prepare(
      'UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?'
    ).bind(user.id),
    env.DB.prepare(
      'INSERT INTO login_logs(tenant_id,user_id,success,ip,user_agent) VALUES(?,?,?,?,?)'
    ).bind(tenant.id, user.id, 1, request.headers.get('CF-Connecting-IP'), request.headers.get('User-Agent'))
  ]);

  return json({
    token: rawToken,
    mustChangePassword: !!user.must_change_password,
    user: { id: user.id, identifier: user.user_identifier },
    tenant: { id: tenant.id, name: tenant.name_ar, identifier: tenant.company_identifier }
  });
});

router.post('/api/auth/logout', async ({ auth, env }) => {
  if (!auth) return json({ ok: true });
  await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?').bind(auth.session.id).run();
  return json({ ok: true });
});

router.get('/api/me', async ({ auth, env }) => {
  if (!auth) return json({ error: 'غير مصرح' }, 401);
  const roles = await env.DB.prepare(`
    SELECT r.code, r.name_ar FROM user_roles ur
    JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND r.enabled=1
  `).bind(auth.user.id).all();

  const permissions = await env.DB.prepare(`
    SELECT DISTINCT p.code, rp.scope_type, rp.scope_value
    FROM role_permissions rp
    JOIN permissions p ON p.id=rp.permission_id
    JOIN user_roles ur ON ur.role_id=rp.role_id
    JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND r.enabled=1
  `).bind(auth.user.id).all();

  return json({
    user: auth.user,
    tenant: auth.tenant,
    roles: roles.results,
    permissions: permissions.results
  });
});

router.get('/api/dashboard', async ({ auth, env }) => {
  if (!auth) return json({ error: 'غير مصرح' }, 401);
  const [employees, pending, nodes] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) c FROM employees WHERE tenant_id=? AND employee_status <> ?').bind(auth.tenant.id,'إنهاء').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM transactions WHERE tenant_id=? AND status=?').bind(auth.tenant.id,'قيد الإجراء').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM organization_nodes WHERE tenant_id=? AND active=1').bind(auth.tenant.id).first()
  ]);
  return json({
    cards: {
      employees: employees?.c || 0,
      pendingTransactions: pending?.c || 0,
      organizationNodes: nodes?.c || 0
    }
  });
});

router.get('/api/employees', async ({ auth, env, url }) => {
  if (!auth) return json({ error: 'غير مصرح' }, 401);
  const q = url.searchParams.get('q')?.trim() || '';
  const rows = await env.DB.prepare(`
    SELECT e.id,e.employee_number,e.first_name,e.father_name,e.family_name,
           e.id_number,e.job_title,e.employee_status,e.join_date,
           p.title_ar AS position_name
    FROM employees e
    LEFT JOIN positions p ON p.id=e.position_id AND p.tenant_id=e.tenant_id
    WHERE e.tenant_id=?
      AND (?='' OR e.employee_number=? OR e.id_number=? OR
           (e.first_name || ' ' || COALESCE(e.family_name,'')) LIKE ?)
    ORDER BY e.employee_number
    LIMIT 200
  `).bind(auth.tenant.id,q,q,q,`%${q}%`).all();
  return json({ results: rows.results });
});

router.get('/api/organization/tree', async ({ auth, env }) => {
  if (!auth) return json({ error: 'غير مصرح' }, 401);
  const nodes = await env.DB.prepare(`
    SELECT * FROM organization_nodes
    WHERE tenant_id=? AND active=1
    ORDER BY parent_id, sort_order, name_ar
  `).bind(auth.tenant.id).all();
  return json({ results: nodes.results });
});

router.get('/api/transactions', async ({ auth, env, url }) => {
  if (!auth) return json({ error: 'غير مصرح' }, 401);
  const number = url.searchParams.get('number')?.trim() || '';
  if (!number) return json({ error: 'البحث في المعاملات يكون برقم المعاملة فقط' }, 400);
  const row = await env.DB.prepare(`
    SELECT t.*, tt.name_ar AS transaction_type_name
    FROM transactions t
    JOIN transaction_types tt ON tt.id=t.transaction_type_id
    WHERE t.tenant_id=? AND t.transaction_number=?
  `).bind(auth.tenant.id, Number(number)).first();
  return json({ result: row || null });
});

export default {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx);
  }
};
