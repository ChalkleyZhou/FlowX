import { IsNotEmpty, IsString } from 'class-validator';

export class GetAuthorizeUrlDto {
  @IsString()
  @IsNotEmpty()
  redirectUri!: string;
}

