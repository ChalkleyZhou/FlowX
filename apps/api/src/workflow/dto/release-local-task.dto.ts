import { Transform } from 'class-transformer';
import { Equals, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReleaseLocalTaskDto {
  @IsString()
  @IsNotEmpty()
  executionSessionId!: string;

  @Equals(true)
  confirmedStopped!: true;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
