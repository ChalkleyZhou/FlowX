import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpsertGitCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  accessToken!: string;
}
