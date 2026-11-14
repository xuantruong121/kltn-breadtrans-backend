import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ACCESS_TOKEN_TTL, getJwtSecret } from './auth.constants';
import { EmailService } from '../../common/email/email.service';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: ACCESS_TOKEN_TTL as any }, // 15 minutes
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy, EmailService],
  exports: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    PassportModule,
    JwtModule,
    EmailService,
  ],
})
export class AuthModule {}
