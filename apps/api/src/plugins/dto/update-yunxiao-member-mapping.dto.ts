import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateYunxiaoMemberMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  yunxiaoUserIdentifier!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  yunxiaoDisplayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  flowxUserId!: string | null;
}
