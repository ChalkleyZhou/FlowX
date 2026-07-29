import type { PrismaClient } from '@prisma/client';

const STATUS_MAP: Record<string, string> = {
  demo_pending: 'spec_plan_pending',
  demo_waiting_confirmation: 'spec_plan_pending',
  task_split_pending: 'spec_plan_pending',
  task_split_waiting_confirmation: 'spec_plan_waiting_confirmation',
  task_split_confirmed: 'spec_plan_confirmed',
  plan_pending: 'spec_plan_pending',
  plan_waiting_confirmation: 'spec_plan_waiting_confirmation',
  plan_confirmed: 'spec_plan_confirmed',
};

export function mapLegacyWorkflowStatus(status: string): string {
  return STATUS_MAP[status] ?? status;
}

export async function migrateWorkflowStatuses(prisma: PrismaClient): Promise<number> {
  const runs = await prisma.workflowRun.findMany({
    select: { id: true, status: true, currentStage: true },
  });
  let updated = 0;
  for (const run of runs) {
    const status = mapLegacyWorkflowStatus(run.status);
    const currentStage =
      run.currentStage === 'demo' ||
      run.currentStage === 'task_split' ||
      run.currentStage === 'technical_plan'
        ? 'spec_plan'
        : run.currentStage;
    if (status !== run.status || currentStage !== run.currentStage) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status, currentStage },
      });
      updated += 1;
    }
  }
  return updated;
}
