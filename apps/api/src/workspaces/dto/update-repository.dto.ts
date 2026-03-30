import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateRepositoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  defaultBranch?: string;
}
