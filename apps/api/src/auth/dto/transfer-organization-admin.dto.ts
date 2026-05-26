import { IsNotEmpty, IsString } from 'class-validator';

export class TransferOrganizationAdminDto {
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;
}
