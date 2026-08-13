import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProjectVersionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
