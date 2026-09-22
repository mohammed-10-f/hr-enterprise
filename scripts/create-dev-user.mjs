
import crypto from 'node:crypto';

const password = process.argv[2] || 'Mm123456';
const hash = crypto.createHash('sha256').update(password).digest('hex');

console.log(`
Run this SQL after migrations:

INSERT OR REPLACE INTO users
(id,tenant_id,user_identifier,password_hash,must_change_password,account_status)
VALUES
('user-demo-admin','tenant-demo','1000000000','${hash}',1,'ACTIVE');

INSERT OR IGNORE INTO user_roles(user_id,role_id)
VALUES('user-demo-admin','role-demo-admin');
`);
