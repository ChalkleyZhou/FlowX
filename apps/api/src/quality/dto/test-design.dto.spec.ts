import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UpdateTestDesignSmokeDto } from './test-design.dto';

const smokeCase = {
  id: 'smoke-1',
  title: '登录主链路冒烟',
  priority: 'P0',
  precondition: null,
  steps: ['使用有效账号登录'],
  expected: '进入首页',
  blocking: true,
  coverageKeys: ['login-main'],
  resolution: 'ACCEPTED',
};

function validateSmokeUpdate(value: unknown) {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  return pipe.transform(value, { type: 'body', metatype: UpdateTestDesignSmokeDto });
}

describe('UpdateTestDesignSmokeDto', () => {
  it('accepts smoke confirmation fields including a null precondition', async () => {
    const payload = { revision: 2, cases: [smokeCase] };
    await expect(validateSmokeUpdate(payload)).resolves.toEqual(payload);
  });

  it('rejects read-only persistence metadata in a smoke confirmation', async () => {
    const result = validateSmokeUpdate({
      revision: 2,
      cases: [{
        ...smokeCase,
        testDesignId: 'design-1',
        sortOrder: 0,
        createdAt: '2026-10-19T00:00:00.000Z',
        updatedAt: '2026-10-19T00:00:00.000Z',
      }],
    });
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: {
        message: expect.arrayContaining([
          'cases.0.property testDesignId should not exist',
          'cases.0.property sortOrder should not exist',
          'cases.0.property createdAt should not exist',
          'cases.0.property updatedAt should not exist',
        ]),
      },
    });
  });
});
