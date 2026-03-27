import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConvertToIssueDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  repositoryId?: string;

  @IsOptional()
  @IsString()
  branchName?: string;
}
