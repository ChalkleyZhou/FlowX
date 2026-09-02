import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateYunxiaoMemberMappingDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  yunxiaoMemberId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  yunxiaoUserId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  aliyunAccountId?: string | null;

  /** 兼容旧版本客户端，新的调用应传入上面的三个身份字段。 */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  yunxiaoUserIdentifier?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  yunxiaoDisplayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  flowxUserId!: string | null;
}
