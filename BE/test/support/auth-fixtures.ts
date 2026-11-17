import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { User } from '@legacy/models/User/user.model';
import { FeedUser } from '@legacy/models/User/feedUser.model';
import Role from '@legacy/models/Role/role.model';
import { SystemAdmin } from '@legacy/models/SystemAdmin/systemAdmin.model';
import { RevokedToken } from '@legacy/models/Auth/revokedToken.model';
import SupportAgent from '@legacy/models/SupportChat/supportAgent.model';
import { memoryDb } from './memory-db';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const oid = () => new mongoose.Types.ObjectId();

/** Seeds users/roles/admins into the memory DB and returns ready-made bearer headers per tier. */
export const seedAuth = () => {
  memoryDb.use(User, FeedUser, Role, SystemAdmin, RevokedToken, SupportAgent);
  const companyId = oid();
  const roleAdmin = { _id: oid(), name: 'admin' }; // default role: no companyId
  const roleCustom = { _id: oid(), name: 'packer', companyId, permission: {} as any };
  const userAdmin = { _id: oid(), name: 'Admin', email: 'admin@x.io', phone: '9000000000', role: roleAdmin._id, companyId, isDisable: false, isDeleted: false };
  const userNoPerm = { _id: oid(), name: 'NoPerm', email: 'np@x.io', role: roleCustom._id, companyId, isDisable: false, isDeleted: false };
  const sysAdmin = { _id: oid(), email: 'sys@x.io', role: 'system-admin' };
  const sysSupport = { _id: oid(), email: 'support@x.io', role: 'support' };
  memoryDb.seed(Role, [roleAdmin, roleCustom]);
  memoryDb.seed(User, [userAdmin, userNoPerm]);
  memoryDb.seed(SystemAdmin, [sysAdmin, sysSupport]);
  const sign = (p: object) => jwt.sign(p, process.env.JWT_SECRET);
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const tokens = {
    admin: sign({ id: String(userAdmin._id), role: String(roleAdmin._id), companyId: String(companyId) }),
    noPerm: sign({ id: String(userNoPerm._id), role: String(roleCustom._id), companyId: String(companyId) }),
    sys: sign({ id: String(sysAdmin._id) }),
    sysSupport: sign({ id: String(sysSupport._id) }),
    bad: jwt.sign({ id: String(userAdmin._id) }, 'wrong-secret'),
  };
  return {
    companyId, roleAdmin, roleCustom, userAdmin, userNoPerm, sysAdmin, tokens,
    h: {
      admin: bearer(tokens.admin), noPerm: bearer(tokens.noPerm), sys: bearer(tokens.sys), sysSupport: bearer(tokens.sysSupport), bad: bearer(tokens.bad), none: {},
    },
    /** give the custom role a permission path like 'accounts::plan::view' */
    grant: (path: string) => {
      const rows = memoryDb.collections.get(Role.collection.collectionName).rows;
      const row = rows.find((r) => r.name === 'packer');
      let cur = row.permission = row.permission || {};
      const keys = path.split('::');
      keys.slice(0, -1).forEach((k) => (cur = cur[k] = cur[k] || {}));
      cur[keys[keys.length - 1]] = true;
    },
  };
};
void crypto;
