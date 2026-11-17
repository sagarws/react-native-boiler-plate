import { Body, Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Role from '@legacy/models/Role/role.model';
import { SERVER_MESSAGE } from '@legacy/enum/response.enum';
import { ensureSystemRoles } from '@legacy/services/systemRoles.service';
import { Post } from '../../core/http/routes';
import { AdminAuth } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';

/**
 * Port of legacy routes/Role/role.routes.ts + controllers/Role/role.controller.ts.
 * Response objects are written literally (key order differs between branches in legacy).
 * Queries (unchanged from legacy): `{ name, companyId }` and `{ companyId }` → Role collection,
 * `{ companyId, systemKey }` → unique partial index companyId_1_systemKey_1, `_id` → primary key.
 * Note: legacy getRoles adds `email` $regex filter on Role (a field Role does not have) — kept as-is.
 */
@Controller('api/role')
export class RoleController {
  @Post('add-role')
  @AdminAuth(['manage_roles::edit'])
  async addRole(@LegacyReq() req: any, @Body() body: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { name, description, permission } = body;
      const user = req.user;

      const roleExist = await Role.findOne({ name, companyId: user.companyId });
      if (roleExist) {
        reply.status(400);
        return {
          isSuccess: false,
          displayMessage: SERVER_MESSAGE.ROLE_NAME_ALREADY_EXISTS,
          message: SERVER_MESSAGE.ROLE_NAME_ALREADY_EXISTS,
        };
      }
      const roleObj = await Role.create({ name, description, permission, createdBy: user.id, companyId: user.companyId });
      reply.status(201);
      return {
        isSuccess: true,
        displayMessage: SERVER_MESSAGE.ROLE_CREATED,
        message: SERVER_MESSAGE.ROLE_CREATED,
        data: roleObj,
      };
    } catch (error) {
      console.error(`Error adding role: ${error}`);
      reply.status(500);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }

  @Post('update-role/:id')
  @AdminAuth(['manage_roles::edit'])
  async updateRole(@LegacyReq() req: any, @Param('id') id: string, @Body() body: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { name, description, permission } = body;
      const exist: any = await Role.findOne({ _id: id });
      // A role of another company (or a global admin/user role, which has no companyId) is reported as not found.
      if (!exist || String(exist.companyId) !== String(req.user?.companyId)) {
        reply.status(404);
        return { isSuccess: false, message: SERVER_MESSAGE.ROLE_NOT_FOUND, displayMessage: SERVER_MESSAGE.ROLE_NOT_FOUND };
      }
      // Built-in roles (constants/systemRoles.ts) are fixed by TrackVid.
      if (exist.systemKey) {
        reply.status(403);
        return { isSuccess: false, message: SERVER_MESSAGE.ROLE_LOCKED, displayMessage: SERVER_MESSAGE.ROLE_LOCKED };
      }
      const sameRoleExist = await Role.findOne({ _id: { $ne: id }, companyId: exist.companyId, name });
      if (sameRoleExist) {
        reply.status(400);
        return { isSuccess: false, message: SERVER_MESSAGE.ROLE_NAME_ALREADY_EXISTS, displayMessage: SERVER_MESSAGE.ROLE_NAME_ALREADY_EXISTS };
      }

      const updatedRoleObj = await Role.findByIdAndUpdate(id, { name, description, permission }, { new: true });
      reply.status(200);
      return { isSuccess: true, message: SERVER_MESSAGE.ROLE_UPDATED, displayMessage: SERVER_MESSAGE.ROLE_UPDATED, data: updatedRoleObj };
    } catch (error) {
      console.error(`Error updating role: ${error}`);
      reply.status(500);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }

  @Get('get-role/:id')
  @AdminAuth(['manage_roles::view'])
  async getRoleById(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const roleObj = await Role.findById(id);
      if (!roleObj) {
        reply.status(404);
        return { isSuccess: false, message: SERVER_MESSAGE.ROLE_NOT_FOUND };
      }
      reply.status(200);
      return { isSuccess: true, displayMessage: SERVER_MESSAGE.ROLE_FOUND, message: SERVER_MESSAGE.ROLE_FOUND, data: roleObj };
    } catch (error) {
      console.error(`Error fetching role by ID: ${error}`);
      reply.status(500);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }

  @Get('get-roles')
  @AdminAuth(['manage_roles::view'])
  async getRoles(@LegacyReq() req: any, @Query('email') email: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const filter: any = { companyId: req.user.companyId };
      if (email) {
        filter.email = { $regex: email, $options: 'i' };
      }

      // Built-in roles are created lazily, the first time the owner lists roles.
      // A failure here must not hide the company's own roles.
      try {
        await ensureSystemRoles(String(req.user.companyId), String(req.user.id));
      } catch (error) {
        console.error(`Error ensuring system roles for company ${req.user.companyId}: ${error}`);
      }

      const roleObj = await Role.find(filter);
      if (roleObj.length === 0) {
        reply.status(404);
        return { isSuccess: false, message: SERVER_MESSAGE.ROLE_NOT_FOUND, displayMessage: SERVER_MESSAGE.ROLE_NOT_FOUND, data: null };
      }
      reply.status(200);
      return { isSuccess: true, displayMessage: SERVER_MESSAGE.ROLE_FOUND, message: SERVER_MESSAGE.ROLE_FOUND, data: roleObj };
    } catch (error) {
      console.error(`Error fetching roles for email ${email}: ${error}`);
      reply.status(500);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }
}
