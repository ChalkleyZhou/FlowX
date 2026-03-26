import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRequirementDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  acceptanceCriteria!: string;
}

