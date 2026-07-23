import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateRepositoryDto {
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
