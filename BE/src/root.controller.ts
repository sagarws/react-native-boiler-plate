import { Controller, Get, Header } from '@nestjs/common';

/** Legacy server.ts: app.get("/", (req, res) => res.send("Hello World!")) */
@Controller()
export class RootController {
  @Get('/')
  @Header('Content-Type', 'text/html; charset=utf-8')
  root(): string {
    return 'Hello World!';
  }
}
