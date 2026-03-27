import { IsNotEmpty, IsObject } from 'class-validator';

export class StageManualEditDto {
  @IsObject()
  @IsNotEmpty()
  output!: Record<string, unknown>;
}
