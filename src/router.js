
import { authenticate } from './lib/auth.js';
import { json } from './lib/http.js';

export class Router {
  constructor() { this.routes = []; }

  get(path, handler) { this.routes.push({ method:'GET', path, handler }); }
  post(path, handler) { this.routes.push({ method:'POST', path, handler }); }

  async handle(request, env, ctx) {
    const url = new URL(request.url);
    const route = this.routes.find(r => r.method === request.method && r.path === url.pathname);

    if (!route) {
      if (url.pathname.startsWith('/api/')) return json({ error:'المسار غير موجود' },404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found',{status:404});
    }

    let auth = null;
    if (!['/api/health','/api/auth/login'].includes(url.pathname)) {
      auth = await authenticate(request, env);
      if (!auth) return json({ error:'انتهت الجلسة أو لم يتم تسجيل الدخول' },401);
    }

    try {
      return await route.handler({ request, env, ctx, url, auth });
    } catch (err) {
      console.error('request_error', { path:url.pathname, message:err?.message });
      return json({ error:'حدث خطأ داخلي' },500);
    }
  }
}
