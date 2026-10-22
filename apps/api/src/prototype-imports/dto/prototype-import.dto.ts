import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePrototypeImportDto {
  @IsString() @IsNotEmpty() projectId!: string;
  @IsOptional() @IsString() @MaxLength(10000) goal?: string;
  @IsOptional() @IsIn(['codex', 'cursor']) aiProvider?: string;
}
export class PrototypeRevisionDto {
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}
export class UpdatePrototypeImportDto extends PrototypeRevisionDto {
  @IsOptional() @IsString() @MaxLength(10000) feedback?: string;
  @IsOptional() @IsObject() analysis?: Record<string, unknown>;
  @IsOptional() @IsObject() answers?: Record<string, string>;
}
