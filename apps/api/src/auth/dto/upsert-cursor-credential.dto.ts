import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpsertCursorCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  apiKey!: string;
}
