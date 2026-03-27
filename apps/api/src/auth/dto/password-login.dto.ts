import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordLoginDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  account!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

