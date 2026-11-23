import { withProjectLabels } from '../projects/project-labels.service';
import type { RequirementProfileFields } from '@flowx-ai/protocol';

/** 只带出已填写的资料，空字符串不进入本地交接。 */
export function requirementProfileFields(workItem: {
  labels?: Array<{ label: { id: string; name: string; color: string } }>;
  priority?: string | null;
  functionalModule?: string | null;
  riskImpact?: string | null;
  productRequirementDocument?: string | null;
  remark?: string | null;
  createdByName?: string | null;
}): RequirementProfileFields {
  const text = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const functionalModule = text(workItem.functionalModule);
  const riskImpact = text(workItem.riskImpact);
  const productRequirementDocument = text(workItem.productRequirementDocument);
  const remark = text(workItem.remark);
  const createdByName = text(workItem.createdByName);
  return {
    ...(workItem.labels ? { labels: withProjectLabels(workItem).labels } : {}),
    ...(workItem.priority ? { priority: workItem.priority } : {}),
    ...(functionalModule ? { functionalModule } : {}),
    ...(riskImpact ? { riskImpact } : {}),
    ...(productRequirementDocument ? { productRequirementDocument } : {}),
    ...(remark ? { remark } : {}),
    ...(createdByName ? { createdByName } : {}),
  };
}
