import { Body, Controller, Delete, Get, Param, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Plan from '@legacy/models/Plan/plan.model';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import { PLAN_TYPE } from '@legacy/enum/common.enum';
import { Post } from '../../core/http/routes';
import { AdminAuth, SystemAdmin } from '../../core/auth';
import { fail, ok } from '../../core/envelope';

/**
 * Port of legacy routes/plan/plan.routes.ts + controllers/plan/plan.controller.ts.
 * Indexes: Plan reads are `{ isDefault, isDeleted }` sorted by credit on a tiny collection
 * (legacy has no dedicated index; unchanged by the port) and `_id` (primary key).
 */
@Controller('api/plan')
export class PlanController {
  @Get()
  @AdminAuth(['accounts::plan::view'])
  async getPlans(@Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const plans = await Plan.find({ isDefault: false, isDeleted: false }).sort({ credit: 1 });
      reply.status(200);
      return { plans };
    } catch (error) {
      reply.status(500);
      return { error: 'Internal Server Error' };
    }
  }

  @Post()
  @SystemAdmin()
  async createPlan(@Body() body: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { name, price, credit, storage, bonus } = body;

      let type: string;
      if (credit) {
        type = PLAN_TYPE.CREDIT;
      } else {
        type = PLAN_TYPE.STORAGE;
      }

      if (!name || !type || !price || (!credit && !storage)) {
        reply.status(SERVER_STATUS_CODE.BAD_REQUEST);
        return fail(SERVER_MESSAGE.MISSING_REQUIRED_FIELDS);
      }

      const plan = await Plan.create({
        name,
        type,
        price,
        credit,
        storage: storage ? storage * 1024 * 1024 : undefined,
        bonus,
      });

      if (!plan) {
        reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
        return fail(SERVER_MESSAGE.PLAN_NOT_CREATED);
      }

      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return ok(SERVER_MESSAGE.PLAN_CREATED, plan);
    } catch (error) {
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return fail(SERVER_MESSAGE.INTERNAL_SERVER);
    }
  }

  @Put(':id')
  @SystemAdmin()
  async updatePlan(@Param('id') id: string, @Body() body: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { name, price, credit, storage, bonus, isActive } = body;

      const updatedPlan = await Plan.findByIdAndUpdate(
        { _id: id },
        {
          name,
          price,
          credit,
          storage: storage ? storage * 1024 * 1024 : undefined,
          bonus,
          isActive,
        },
        { new: true },
      );

      if (!updatedPlan) {
        reply.status(SERVER_STATUS_CODE.NOT_FOUND);
        return fail(SERVER_MESSAGE.PLAN_NOT_UPDATED);
      }

      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return ok(SERVER_MESSAGE.PLAN_UPDATED, updatedPlan);
    } catch (error) {
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return fail(SERVER_MESSAGE.INTERNAL_SERVER);
    }
  }

  @Delete(':id')
  @SystemAdmin()
  async deletePlan(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const deletedPlan = await Plan.findByIdAndUpdate({ _id: id }, { isDeleted: true }, { new: true });

      if (!deletedPlan) {
        reply.status(SERVER_STATUS_CODE.NOT_FOUND);
        return fail(SERVER_MESSAGE.PLAN_NOT_DELETED);
      }

      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return ok(SERVER_MESSAGE.PLAN_DELETED, deletedPlan);
    } catch (error) {
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return fail(SERVER_MESSAGE.INTERNAL_SERVER);
    }
  }
}
