import { Module } from '@nestjs/common';
import { InternalRealtimeController } from './internal-realtime.controller';
import { ApiInternalRealtimeController } from './api-internal-realtime.controller';

/**
 * Receiver for realtime events forwarded by other processes (POST …/realtime/broadcast).
 * It emits into THIS process's Socket.IO, which exists only with LEGACY_BACKGROUND=on.
 * Route /internal (and /api/internal) to this server in nginx ONLY together with that switch;
 * with it off the handler would forward to REALTIME_INTERNAL_URL again.
 */
@Module({ controllers: [InternalRealtimeController, ApiInternalRealtimeController] })
export class RealtimeModule {}
