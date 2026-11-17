import {
  adminAuth, authMiddleware, easyEcomAuth, externalClientAuth, getVideoAuth, normalAuth,
  supportAgentAuth, systemAdminAuth, systemAdminRole, validationMiddleware,
} from './legacy-middleware';
import { Legacy } from '../legacy/legacy-middleware.guard';
import type { LegacyMiddleware } from '../legacy/express-adapter';

/**
 * Auth tiers as Nest decorators. Each one runs the legacy middleware itself, so status codes,
 * bodies, `req.user` shape and the `?token=` rule are identical to legacy.
 *
 *   @Auth()                          ≙ authMiddleware            (header or ?token=)
 *   @NormalAuth()                    ≙ normalAuth
 *   @AdminAuth(['perm::sub'])        ≙ adminAuth([...])
 *   @SystemAdmin()                   ≙ systemAdminAuth
 *   @SystemAdmin('system-admin')     ≙ systemAdminAuth, systemAdminRole('system-admin')  (= adminOnly)
 *   @SupportAgentAuth() / @ExternalClientAuth() / @EasyEcomAuth() / @GetVideoAuth()
 *   @Validate(joiSchema)             ≙ validationMiddleware(schema)
 * For chains mixing these (e.g. auth + validation), use `@Legacy(mw1, mw2, ...)` in legacy order.
 */
export const Auth = () => Legacy(authMiddleware as LegacyMiddleware);
export const NormalAuth = () => Legacy(normalAuth as LegacyMiddleware);
export const AdminAuth = (permissions: string[] = []) => Legacy(adminAuth(permissions) as LegacyMiddleware);
export const SystemAdmin = (...roles: string[]) =>
  Legacy(systemAdminAuth as LegacyMiddleware, ...(roles.length ? [systemAdminRole(...roles) as LegacyMiddleware] : []));
export const SupportAgentAuth = () => Legacy(supportAgentAuth as LegacyMiddleware);
export const ExternalClientAuth = () => Legacy(externalClientAuth as LegacyMiddleware);
export const EasyEcomAuth = () => Legacy(easyEcomAuth as LegacyMiddleware);
export const GetVideoAuth = () => Legacy(getVideoAuth as LegacyMiddleware);
export const Validate = (schema: unknown) => Legacy(validationMiddleware(schema) as LegacyMiddleware);

export { Legacy };
export * from './legacy-middleware';
