import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StageFeedbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  feedback!: string;
}
