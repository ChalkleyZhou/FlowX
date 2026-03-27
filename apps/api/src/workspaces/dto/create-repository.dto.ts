import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRepositoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsOptional()
  @IsString()
  defaultBranch?: string;
}
