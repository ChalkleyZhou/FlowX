import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePersonalApiTokenDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}
