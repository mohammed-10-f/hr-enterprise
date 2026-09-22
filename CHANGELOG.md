# Changelog

## Unreleased — foundation correctness pass

This pass did not add new modules. It closed gaps between the existing code and the
approved requirements that were either security-sensitive or silently contradicted an
explicit, unambiguous requirement. No feature was removed and no scope was added beyond
what follows.

### Fixed
- **Password hashing was insecure.** `hashPassword()` was a single unsalted SHA-256 call —
  the same weak scheme used for both stored passwords and session tokens. Passwords are now
  hashed with salted PBKDF2-SHA256 (210,000 iterations, `src/lib/crypto.js`). Session tokens
  keep a fast unsalted hash (`hashToken`) since they are already high-entropy random values,
  not user-chosen secrets — reusing the slow KDF there would have added real per-request
  latency for no security benefit. Any password hash created before this change is upgraded
  transparently to the new scheme the next time that user logs in successfully; nothing needs
  to be reset by hand.
- **Rehire was structurally impossible.** `employees` had `UNIQUE(tenant_id, id_number)`,
  which directly contradicts the requirement that a national ID may repeat across employment
  episodes while the employee number never repeats. `migrations/0003_employee_rehire_identity.sql`
  rebuilds the table without that constraint and replaces it with a partial unique index that
  only enforces uniqueness among employees who are **not** terminated — so a closed record and
  a fresh rehire record can coexist, but two simultaneously-active records for the same person
  still cannot.
- **Employee creation did not create a login account.** The specification is explicit that
  creating an employee must auto-provision a login (username = ID number, temporary password
  `Mm123456`, forced change on first login) — this step was entirely missing from
  `POST /api/employees`. It's now implemented, including the rehire case: if a (likely
  disabled) account already exists for that ID number, it is reactivated and re-linked to the
  new employee record rather than creating a duplicate account.
- **The forced password-change requirement was unenforceable.** The backend returned a
  `mustChangePassword` flag but nothing consumed it — there was no endpoint to change a
  password and no screen that required it. Added `POST /api/auth/change-password` and a
  blocking screen in the frontend that appears immediately after a login carrying a temporary
  password, before the rest of the application becomes reachable.
- **Company Admin could not disable/re-enable a login without deleting the employee.** Added
  `POST /api/admin/users/status`, restricted to `users.manage`, which flips `account_status`
  and immediately revokes any active session on disable (previously a disabled account would
  have kept working until its token expired, since nothing referenced `account_status` after
  authentication).

### Not changed in this pass
Everything else in the codebase is unchanged. In particular, none of the following were
touched — they remain exactly as scoped in the accompanying assessment: the workflow
return/feedback actions, stage timers, the incoming/outgoing/my-transactions lists, leave
balance/reservation logic, advances/deductions/additions business rules, payroll close/lock
approval, termination/settlement calculation, notifications, attachments, the organization
tree visualization, and automated tests.
