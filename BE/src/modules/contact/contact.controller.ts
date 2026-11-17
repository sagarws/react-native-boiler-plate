import { Body, Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Contact from '@legacy/models/Contact/contact.model';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import validateRequest from '@legacy/utils/validateRequest';
import { createContactSchema } from '@legacy/validations/Contact/contact.validation';
import { Post } from '../../core/http/routes';
import { Auth, Legacy, authMiddleware } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';

/**
 * Port of legacy routes/Contact/contact.routes.ts (PUT /update/:id is commented out in legacy → not ported).
 * Query `{ companyId, isDeleted }` on Contact: unchanged from legacy (no dedicated index in legacy).
 */
@Controller('api/contacts')
export class ContactController {
  @Get()
  @Auth()
  async getContacts(@LegacyReq() req: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const companyId = req.companyId;
      const contacts = await Contact.find({ companyId, isDeleted: false }).select('-isDeleted -__v');
      const contactLength = contacts.length;
      const responsePayload = {
        count: contactLength > 0 ? contacts.length : 0,
        isSuccess: contactLength > 0 ? true : false,
        data: contactLength > 0 ? contacts : [],
      };
      if (contactLength < 0) {
        reply.status(SERVER_STATUS_CODE.NOT_FOUND);
        return responsePayload;
      }
      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return responsePayload;
    } catch (error: any) {
      console.error('Error found in getContacts ::', error);
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }

  @Post('create')
  @Legacy(authMiddleware, validateRequest(createContactSchema))
  async createContact(@LegacyReq() req: any, @Body() body: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { name, email, phone } = body;
      const companyId = req.companyId;
      const _email = email.toLowerCase();
      const newContact = await Contact.create({ companyId, name, email: _email, phone });
      await newContact.save();

      if (!newContact) {
        reply.status(SERVER_STATUS_CODE.BAD_REQUEST);
        return { isSuccess: false, message: SERVER_MESSAGE.CONTACT_NOT_CREATED, displayMessage: SERVER_MESSAGE.CONTACT_NOT_CREATED };
      }
      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return { isSuccess: true, message: SERVER_MESSAGE.CONTACT_CREATED, displayMessage: SERVER_MESSAGE.CONTACT_CREATED, data: newContact };
    } catch (error: any) {
      console.error('Error found in createContact ::', error);
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }
}
