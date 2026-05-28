import { IsNotEmpty, IsString } from 'class-validator';

export class BugScreenshotUploadDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @IsString()
  @IsNotEmpty()
  dataBase64!: string;
}
