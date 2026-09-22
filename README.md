# HR Enterprise — Institutional Release

Arabic RTL enterprise HR system built for Cloudflare Workers + D1.

## Included
- Multi-company tenant scope.
- Login/session management.
- Unlimited custom roles and granular permissions with scopes: COMPANY, SELF, MANAGED_EMPLOYEES, ORGANIZATION, ALL.
- Company scope administration.
- User administration and role assignment.
- Organization units and positions.
- Employee master data with initial salary and GOSI setup.
- Transaction definitions, transaction simulator, real transaction list.
- Custom workflow definitions with administrator-named stages and stage owners.
- Payroll runs with automatic calculation from salary components, additions, deductions and GOSI.
- Operational reports.
- Audit log.
- Arabic RTL interface with the sidebar on the RIGHT.

## Existing D1
This release is configured for the existing database:
- database name: hr-enterprise
- database id: 43d377a3-8ba3-47ed-adf7-03ec0097ff40

## Deployment
Upload the contents of this archive to the existing GitHub repository `hr-enterprise`.
Do not create another D1 database.
Cloudflare should redeploy the Worker from the repository.

## Important
The system is intentionally data-driven. It does not invent attendance or external integrations that were not requested. Those can be added as separate integrations later.
