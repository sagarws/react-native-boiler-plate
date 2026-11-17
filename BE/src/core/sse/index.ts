/**
 * SSE endpoints are served by running the legacy stream handler on the raw response
 * (`runLegacyHandler`): same headers, same `data: …\n\n` framing, same `req.on('close')` teardown.
 *
 *   @Get('stream') @Auth()
 *   stream(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
 *     return runLegacyHandler(req, reply, legacyStreamController);
 *   }
 */
export { runLegacyHandler } from '../legacy/run-legacy-handler';
