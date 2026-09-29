import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness check',
    description: 'Answers 200 with a plain-text greeting while the API is up.',
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
