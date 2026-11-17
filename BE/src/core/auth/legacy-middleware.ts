/**
 * The legacy auth/validation middlewares, imported unchanged from the pinned submodule.
 * Guards in this folder execute them through `core/legacy/express-adapter`, so every
 * 401/403/422 status, body and side effect is the legacy one by construction.
 */
export { default as authMiddleware } from '@legacy/middleware/authentication.middleware';
export { normalAuth } from '@legacy/middleware/normalAuth.middleware';
export { default as adminAuth } from '@legacy/middleware/adminAuth.middleware';
export { systemAdminAuth } from '@legacy/middleware/systemAdminAuth.middleware';
export { systemAdminRole } from '@legacy/middleware/systemAdminRole.middleware';
export { supportAgentAuth } from '@legacy/middleware/supportAgentAuth.middleware';
export { default as externalClientAuth } from '@legacy/middleware/externalClientAuth.middleware';
export { checkBearerToken as easyEcomAuth } from '@legacy/middleware/easy-ecom-auth.middleware';
export { checkBearerToken as getVideoAuth } from '@legacy/middleware/getVideo-auth.middleware';
export { default as validationMiddleware } from '@legacy/middleware/validation.middleware';
