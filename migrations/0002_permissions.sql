
INSERT OR IGNORE INTO permissions(id, code, name_ar, domain) VALUES
('p.dashboard.view','dashboard.view','عرض لوحة التحكم','dashboard'),
('p.employees.view','employees.view','عرض الموظفين','employees'),
('p.employees.create','employees.create','إنشاء موظف','employees'),
('p.employees.edit','employees.edit','تعديل موظف','employees'),
('p.employees.delete','employees.delete','حذف/إلغاء موظف','employees'),
('p.employees.salary.view','employees.salary.view','عرض الراتب','employees'),
('p.employees.salary.edit','employees.salary.edit','تعديل بيانات الراتب','employees'),
('p.organization.view','organization.view','عرض الهيكل التنظيمي','organization'),
('p.organization.manage','organization.manage','إدارة الهيكل التنظيمي','organization'),
('p.transactions.view','transactions.view','عرض المعاملات','transactions'),
('p.transactions.create','transactions.create','إنشاء المعاملة','transactions'),
('p.transactions.approve','transactions.approve','تمرير المعاملة','transactions'),
('p.transactions.return','transactions.return','إعادة المعاملة','transactions'),
('p.transactions.reject','transactions.reject','رفض المعاملة','transactions'),
('p.transactions.cancel','transactions.cancel','إلغاء المعاملة','transactions'),
('p.transactions.complete','transactions.complete','إكمال المعاملة','transactions'),
('p.workflows.view','workflows.view','عرض مسارات العمل','workflows'),
('p.workflows.manage','workflows.manage','إدارة مسارات العمل','workflows'),
('p.leave.view','leave.view','عرض الإجازات','leave'),
('p.leave.create','leave.create','إنشاء إجازة','leave'),
('p.leave.approve','leave.approve','اعتماد الإجازة','leave'),
('p.leave.adjust','leave.adjust','تعديل رصيد الإجازة','leave'),
('p.absence.view','absence.view','عرض الغياب','absence'),
('p.absence.manage','absence.manage','إدارة الغياب','absence'),
('p.advances.view','advances.view','عرض السلف','finance'),
('p.advances.create','advances.create','إنشاء سلفة','finance'),
('p.deductions.view','deductions.view','عرض الخصومات','finance'),
('p.deductions.manage','deductions.manage','إدارة الخصومات','finance'),
('p.additions.view','additions.view','عرض الإضافات','finance'),
('p.additions.manage','additions.manage','إدارة الإضافات','finance'),
('p.payroll.view','payroll.view','عرض الرواتب','payroll'),
('p.payroll.run','payroll.run','تشغيل الرواتب','payroll'),
('p.payroll.approve','payroll.approve','اعتماد الرواتب','payroll'),
('p.reports.view','reports.view','عرض التقارير','reports'),
('p.reports.export','reports.export','تصدير التقارير','reports'),
('p.audit.view','audit.view','عرض سجل التدقيق','security'),
('p.users.manage','users.manage','إدارة المستخدمين','administration'),
('p.roles.manage','roles.manage','إدارة الأدوار','administration');

INSERT OR IGNORE INTO roles(id, tenant_id, code, name_ar, system_role)
VALUES
('role.super_admin',NULL,'super_admin','مدير النظام',1);

INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope_type)
SELECT 'role.super_admin', id, 'COMPANY' FROM permissions;
