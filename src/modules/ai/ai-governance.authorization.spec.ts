import { GoneException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AiController } from './ai.controller';
import { AiGeneratorController } from './ai-generator.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('AI authoring governance authorization', () => {
  it('protects the governed Admin generator controller with JWT + ADMIN role', () => {
    expect(Reflect.getMetadata('__guards__', AiGeneratorController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
    expect(Reflect.getMetadata(ROLES_KEY, AiGeneratorController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('protects legacy content-generation routes with the Admin role', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AiController.prototype.generateDictation),
    ).toEqual([Role.ADMIN]);
    expect(
      Reflect.getMetadata(
        '__guards__',
        AiController.prototype.generateDictation,
      ),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(
      Reflect.getMetadata(ROLES_KEY, AiController.prototype.importEtsPdf),
    ).toEqual([Role.ADMIN]);
  });

  it('closes the old direct Dictation authoring implementation', () => {
    const controller = new AiController({} as never);
    expect(() => controller.generateDictation({} as never)).toThrow(
      GoneException,
    );
  });
});
