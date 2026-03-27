import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateRepositoryBranchDto {
  @IsString()
  @IsNotEmpty()
  currentBranch!: string;
}
