import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateBugDto {
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
  @IsIn(['OPEN', 'CONFIRMED', 'FIXING', 'FIXED', 'VERIFIED', 'CLOSED', 'WONT_FIX'])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity?: string;

  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  expectedBehavior?: string;

  @IsOptional()
  @IsString()
  actualBehavior?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reproductionSteps?: string[];

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  branchName?: string;
}
