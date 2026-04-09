import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartBrainstormDto {
  @IsOptional()
  @IsString()
  humanHint?: string;
}

export class ReviseBrainstormDto {
  @IsString()
  @IsNotEmpty()
  feedback!: string;
}

export class StartDesignDto {
  @IsOptional()
  @IsString()
  humanHint?: string;
}

export class ReviseDesignDto {
  @IsString()
  @IsNotEmpty()
  feedback!: string;
}
