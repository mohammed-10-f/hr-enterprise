
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  company_identifier TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT,
  user_identifier TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(account_status IN ('ACTIVE','DISABLED','LOCKED')),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_identifier)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  success INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  system_role INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  domain TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  scope_type TEXT NOT NULL,
  scope_value TEXT,
  PRIMARY KEY(role_id, permission_id, scope_type, scope_value)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  effect TEXT NOT NULL CHECK(effect IN ('ALLOW','DENY')),
  scope_type TEXT NOT NULL,
  scope_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, permission_id, effect, scope_type, scope_value)
);

CREATE TABLE IF NOT EXISTS organization_nodes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  parent_id TEXT REFERENCES organization_nodes(id),
  name_ar TEXT NOT NULL,
  name_en TEXT,
  node_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_tenant_parent ON organization_nodes(tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  organization_node_id TEXT REFERENCES organization_nodes(id),
  title_ar TEXT NOT NULL,
  title_en TEXT,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  identity_key TEXT NOT NULL,
  employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  father_name TEXT,
  grandfather_name TEXT,
  family_name TEXT,
  english_name TEXT,
  gender TEXT,
  birth_date TEXT,
  nationality TEXT,
  marital_status TEXT,
  identity_type TEXT NOT NULL,
  id_number TEXT NOT NULL,
  id_expiry_date TEXT,
  id_issue_date TEXT,
  id_issuing_authority TEXT,
  mobile TEXT,
  email TEXT,
  short_address TEXT,
  join_date TEXT NOT NULL,
  job_title TEXT,
  position_id TEXT REFERENCES positions(id),
  organization_node_id TEXT REFERENCES organization_nodes(id),
  branch_id TEXT,
  work_location_id TEXT,
  direct_manager_id TEXT REFERENCES employees(id),
  employee_status TEXT NOT NULL DEFAULT 'نشط' CHECK(employee_status IN ('نشط','معلق','إجازة','إنهاء')),
  bank_name TEXT,
  iban TEXT,
  photo_key TEXT,
  internal_extension TEXT,
  previous_employee_number TEXT,
  general_notes TEXT,
  active_identity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, employee_number),
  UNIQUE(tenant_id, id_number)
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_status ON employees(tenant_id, employee_status);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(tenant_id, direct_manager_id);

CREATE TABLE IF NOT EXISTS employee_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  source_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  field_key TEXT NOT NULL,
  field_value TEXT,
  UNIQUE(employee_id, field_key)
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  contract_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  duration_days INTEGER,
  auto_renewal INTEGER NOT NULL DEFAULT 0,
  renewal_duration_months INTEGER,
  notice_period_days INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  previous_contract_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS probation (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  start_date TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 180),
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'قيد التجربة',
  evaluation_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_components (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  component_type TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('FIXED','PERCENTAGE')),
  value REAL NOT NULL,
  effective_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS salary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  source_transaction_id TEXT,
  snapshot_json TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insurance (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  subscriber_number TEXT,
  contribution_status TEXT,
  contribution_rule TEXT,
  system_indicator TEXT,
  employee_rate REAL,
  employer_rate REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, employee_id)
);

CREATE TABLE IF NOT EXISTS transaction_types (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name_ar TEXT NOT NULL,
  code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  transaction_type_id TEXT REFERENCES transaction_types(id),
  name_ar TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  name_ar TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  owner_type TEXT NOT NULL,
  owner_config_json TEXT NOT NULL DEFAULT '{}',
  duration_minutes INTEGER,
  actions_json TEXT NOT NULL DEFAULT '[]',
  questions_json TEXT NOT NULL DEFAULT '[]',
  feedback_config_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(workflow_id, stage_order)
);

CREATE TABLE IF NOT EXISTS workflow_conditions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  stage_id TEXT REFERENCES workflow_stages(id),
  expression_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_routes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  from_stage_id TEXT NOT NULL REFERENCES workflow_stages(id),
  to_stage_id TEXT REFERENCES workflow_stages(id),
  condition_id TEXT REFERENCES workflow_conditions(id),
  route_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  stage_id TEXT NOT NULL REFERENCES workflow_stages(id),
  action_code TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  transaction_number INTEGER NOT NULL,
  transaction_type_id TEXT NOT NULL REFERENCES transaction_types(id),
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  employee_id TEXT REFERENCES employees(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'قيد الإجراء' CHECK(status IN ('قيد الإجراء','مكتملة','ملغية','مرفوضة')),
  current_stage_id TEXT REFERENCES workflow_stages(id),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(tenant_id, transaction_number)
);

CREATE TABLE IF NOT EXISTS transaction_sequences (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transaction_stage_instances (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  stage_id TEXT NOT NULL REFERENCES workflow_stages(id),
  round_number INTEGER NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  target_at TEXT,
  completed_at TEXT,
  return_reason TEXT
);

CREATE TABLE IF NOT EXISTS transaction_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  stage_instance_id TEXT NOT NULL REFERENCES transaction_stage_instances(id),
  question_key TEXT NOT NULL,
  answer_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transaction_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  stage_instance_id TEXT REFERENCES transaction_stage_instances(id),
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fixed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name_ar TEXT NOT NULL,
  code TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS leave_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  priority INTEGER NOT NULL,
  eligibility_json TEXT NOT NULL DEFAULT '{}',
  accrual_json TEXT NOT NULL DEFAULT '{}',
  balance_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  source_year INTEGER NOT NULL,
  entitled REAL NOT NULL DEFAULT 0,
  used REAL NOT NULL DEFAULT 0,
  reserved REAL NOT NULL DEFAULT 0,
  remaining REAL NOT NULL DEFAULT 0,
  UNIQUE(employee_id, leave_type_id, source_year)
);

CREATE TABLE IF NOT EXISTS leave_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  transaction_id TEXT REFERENCES transactions(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL,
  status TEXT NOT NULL,
  allocation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_adjustments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
  days REAL NOT NULL,
  reason TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  attachment_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS absences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  absence_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS advances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  transaction_id TEXT REFERENCES transactions(id),
  amount REAL NOT NULL,
  installment_amount REAL,
  installment_count INTEGER,
  first_deduction_month TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS installments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  advance_id TEXT NOT NULL REFERENCES advances(id),
  installment_number INTEGER NOT NULL,
  due_month TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  UNIQUE(advance_id, installment_number)
);

CREATE TABLE IF NOT EXISTS deductions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('ONE_TIME','MONTHLY')),
  months INTEGER,
  remaining_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS additions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('ONE_TIME','MONTHLY')),
  months INTEGER,
  remaining_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  payroll_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  approval_transaction_id TEXT,
  calculated_at TEXT,
  locked_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(tenant_id, payroll_month)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id TEXT PRIMARY KEY,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  basic_salary REAL NOT NULL DEFAULT 0,
  gross REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  calculation_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  transaction_id TEXT REFERENCES transactions(id),
  termination_reason TEXT,
  termination_date TEXT,
  last_working_day TEXT,
  net_settlement REAL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  calculation_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT REFERENCES employees(id),
  asset_type TEXT NOT NULL,
  delivery_date TEXT,
  status TEXT NOT NULL,
  return_date TEXT,
  custom_fields_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS dependents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS education (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS experience (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS languages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS visa_iqama (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS passports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  passport_number TEXT,
  issue_date TEXT,
  expiry_date TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT REFERENCES tenants(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  record_id TEXT,
  old_value_json TEXT,
  new_value_json TEXT,
  ip TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_impersonation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  super_admin_user_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  reason TEXT,
  operations_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_status ON transactions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_tenant_employee ON leave_transactions(tenant_id, employee_id);
