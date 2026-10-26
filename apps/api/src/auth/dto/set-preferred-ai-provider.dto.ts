import { IsIn } from 'class-validator';

export class SetPreferredAiProviderDto {
  @IsIn(['cursor', 'codex'])
  provider!: 'cursor' | 'codex';
}
