import crypto from 'node:crypto';

// Mirrors src/lib/crypto.js hashPassword(): pbkdf2$<iterations>$<saltHex>$<hashHex>
const ITERATIONS = 210000;
const password = process.argv[2] || 'Mm123456';
const salt = crypto.randomBytes(16);
const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const hash = `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;

console.log(`
Run this SQL after migrations:

INSERT OR REPLACE INTO users
(id,tenant_id,user_identifier,password_hash,must_change_password,account_status)
VALUES
('user-demo-admin','tenant-demo','1000000000','${hash}',1,'ACTIVE');

INSERT OR IGNORE INTO user_roles(user_id,role_id)
VALUES('user-demo-admin','role-demo-admin');
`);
