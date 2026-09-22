-- Fix: the original employees table declared UNIQUE(tenant_id, id_number), which blocks
-- rehire (spec: the national ID may repeat across employment episodes; only the employee
-- number is guaranteed unique and never reused). SQLite cannot drop an inline UNIQUE
-- constraint directly, so the table is rebuilt without it and a partial unique index is
-- added instead: id_number stays unique only among employees who are not terminated,
-- which is what actually prevents two simultaneously-active records for the same person
-- while still allowing a closed ('إنهاء') record and a fresh rehire record to coexist.

PRAGMA foreign_keys = OFF;

CREATE TABLE employees_rebuild (
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
  UNIQUE(tenant_id, employee_number)
);

INSERT INTO employees_rebuild SELECT
  id,tenant_id,identity_key,employee_number,first_name,father_name,grandfather_name,family_name,
  english_name,gender,birth_date,nationality,marital_status,identity_type,id_number,id_expiry_date,
  id_issue_date,id_issuing_authority,mobile,email,short_address,join_date,job_title,position_id,
  organization_node_id,branch_id,work_location_id,direct_manager_id,employee_status,bank_name,iban,
  photo_key,internal_extension,previous_employee_number,general_notes,active_identity,created_at,updated_at
FROM employees;

DROP TABLE employees;
ALTER TABLE employees_rebuild RENAME TO employees;

-- id_number is unique per tenant only among employees who are not terminated, which is the
-- actual business rule: it may repeat once a prior record is closed out via rehire.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_active_identity
  ON employees(tenant_id, id_number) WHERE employee_status <> 'إنهاء';

CREATE INDEX IF NOT EXISTS idx_employees_tenant_status ON employees(tenant_id, employee_status);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(tenant_id, direct_manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_identity_key ON employees(tenant_id, identity_key);

PRAGMA foreign_keys = ON;
