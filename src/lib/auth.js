
import { hashToken } from './crypto.js';

export async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const raw = header.slice(7).trim();
  if (!raw) return null;

  const tokenHash = await hashToken(raw);
  const row = await env.DB.prepare(`
    SELECT s.*, u.user_identifier, u.account_status, u.must_change_password,
           t.company_identifier, t.name_ar tenant_name, t.active tenant_active
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    JOIN tenants t ON t.id=s.tenant_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.account_status='ACTIVE'
      AND t.active=1
  `).bind(tokenHash).first();

  if (!row) return null;

  return {
    session: row,
    user: {
      id: row.user_id,
      identifier: row.user_identifier,
      mustChangePassword: !!row.must_change_password
    },
    tenant: {
      id: row.tenant_id,
      identifier: row.company_identifier,
      name: row.tenant_name
    }
  };
}
