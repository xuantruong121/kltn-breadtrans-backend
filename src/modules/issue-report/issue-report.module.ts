import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { IssueReportController } from './issue-report.controller';
import { AdminIssueReportController } from './admin-issue-report.controller';
import { IssueReportService } from './issue-report.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [IssueReportController, AdminIssueReportController],
  providers: [IssueReportService],
  exports: [IssueReportService],
})
export class IssueReportModule {}
