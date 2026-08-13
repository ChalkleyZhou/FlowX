import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateProjectVersionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
