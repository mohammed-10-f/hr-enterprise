# Architecture

## Principles
1. Tenant context comes from the authenticated session.
2. Every tenant-owned table carries `tenant_id`.
3. Authorization is evaluated server-side.
4. Business logic belongs to domain services, not browser code.
5. Workflow definitions are data-driven.
6. Career history and audit logs are separate.
7. External integrations are intentionally outside the current implementation.

## Domains
Authentication, Authorization, Organization, Employee, Workflow, Transactions, Leave, Finance, Payroll, Settlement, Reporting, Notifications, Administration.

## Security
Sessions use opaque bearer tokens stored as hashes in D1. Production hardening should add stronger password KDF parameters/secret management, rate limiting at the edge, secure headers, CSRF strategy for cookie-based sessions if adopted, and encrypted object storage for sensitive attachments.

## D1
The schema is normalized around domain boundaries and tenant-aware foreign keys. Critical unique constraints are tenant-scoped.

## Workflow
A Transaction references a versioned Workflow Definition. Each Stage has an owner configuration, duration, questions and actions. Returns create new stage rounds rather than changing the historical round.

## Production rule
No module is considered functionally complete merely because its page exists. Domain services and tests must be implemented before marking a phase complete.
