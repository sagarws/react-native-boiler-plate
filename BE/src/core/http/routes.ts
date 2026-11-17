import { applyDecorators, HttpCode, Post as NestPost } from '@nestjs/common';

/**
 * Express answers every route with 200 unless the handler sets a status; Nest's @Post defaults
 * to 201. Ported controllers import `Post` from here (never from @nestjs/common).
 */
export const Post = (path?: string | string[]) => applyDecorators(NestPost(path), HttpCode(200));

export { Get, Put, Patch, Delete, Head, Options, All } from '@nestjs/common';
