# Release checklist
1. Apply migrations in order, including `0003_employee_rehire_identity.sql`, before deploying the updated Worker code (`npm run db:migrate:remote`).
2. Push repository contents.
3. Confirm Cloudflare deployment succeeds.
4. Open `/api/health`.
5. Sign in with the existing Super Admin account. Existing plain-SHA256 password hashes are upgraded to salted PBKDF2 automatically on next successful login — no manual reset needed.
6. Confirm the right-side navigation shows Administration.
7. Create a company, role, user, organization unit, position and transaction type.
8. Build a workflow with named stages.
9. Create an employee with salary and GOSI settings, and confirm a login account was auto-provisioned (username = ID number, forced temporary password).
10. Log in as that new employee account and confirm the forced password-change screen appears and blocks access until completed.
11. Terminate an employee's status and confirm a second employee record can be created with the same ID number (rehire) with a new employee number, and that the original account is reactivated rather than duplicated.
12. Disable a user account from the Users page and confirm their existing session stops working immediately.
13. Open a payroll month and calculate it.
