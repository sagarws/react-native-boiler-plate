import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  createRazorpayOrder, paymentEvent, paymentStatus, verifyRazorpaySignature, verifyCheckoutPayment, orderEvent, paymentHistory,
} from '@legacy/controllers/razorpay/razorpay.controller';
import { Post } from '../../core/http/routes';
import { Auth, Legacy, adminAuth, authMiddleware } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/razorpay/razorpay.router.ts (handlers delegated).
 * Webhook signatures: legacy HMACs `JSON.stringify(req.body)` (body-parser output), not the raw
 * bytes; the same body-parser runs here, so signatures verify identically (parity-tested).
 * Legacy quirk kept: POST /place-order passes the adminAuth FACTORY as middleware → hangs.
 */
@Controller('api/razorpay')
export class RazorpayController {
  /** legacy: inline `res.send("Hello from Razorpay!")` */
  @Get() @Header('Content-Type', 'text/html; charset=utf-8') hello() { return 'Hello from Razorpay!'; }
  @Post('place-order') @Legacy(adminAuth as unknown as MW) placeOrder(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createRazorpayOrder); }
  @Post('verify-signature') verifySig(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, verifyRazorpaySignature); }
  @Post('verify-payment') @Auth() verifyPayment(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, verifyCheckoutPayment); }
  @Post('payment-event') payEvent(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, paymentEvent); }
  @Post('payment-status') payStatus(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, paymentStatus); }
  @Post('order-event') ordEvent(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, orderEvent); }
  @Post('payment-history') @Legacy(adminAuth(['accounts::purchase_history::view']) as MW, authMiddleware as MW) history(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, paymentHistory); }
}
