# HR Enterprise SaaS — Fresh Build

نظام SaaS مؤسسي جديد بالكامل مبني وفق المواصفات المعتمدة.

## التقنية
- Cloudflare Workers
- Cloudflare D1 (SQLite)
- Vanilla ES Modules frontend بدون framework ثقيل
- Arabic RTL
- REST API
- Server-side authorization
- Tenant isolation
- Migration-based database

## مهم
هذه النسخة هي Foundation جديدة وليست ترقية للمشروع القديم. لا تعتمد على جداول أو منطق المشروع السابق.

## التشغيل
1. ثبّت Node.js 20+.
2. `npm install`
3. أنشئ D1:
   `npx wrangler d1 create hr-enterprise`
4. ضع `database_id` في `wrangler.toml`.
5. طبّق migration:
   `npx wrangler d1 migrations apply hr-enterprise --local`
6. شغّل:
   `npm run dev`

للإنتاج:
`npx wrangler d1 migrations apply hr-enterprise --remote`
ثم:
`npm run deploy`

## بيانات الدخول التطويرية
بعد تطبيق migration يوجد Tenant تجريبي وحساب Super Admin محلي فقط:
- Company ID: `DEMO`
- User ID: `1000000000`
- Password: `Mm123456`

يجب تغيير كلمة المرور في أول دخول.

> بيانات التطوير معزولة في seed.sql ولا تُستخدم كبيانات إنتاج.

## النطاق
Attendance والتكاملات الخارجية غير منفذة. النظام API-ready مع حدود تكامل واضحة.
