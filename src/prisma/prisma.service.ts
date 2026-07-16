import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    // Prisma 7+ yêu cầu phải truyền cấu hình không rỗng vào super()
    super({
      log: ['info', 'warn', 'error'],
    });
  }
}
