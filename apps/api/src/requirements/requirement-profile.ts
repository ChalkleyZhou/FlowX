import type { RequirementProfileFields } from '@flowx-ai/protocol';

/** 只带出已填写的资料，空字符串不进入本地交接。 */
export function requirementProfileFields(requirement: {
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
  const functionalModule = text(requirement.functionalModule);
  const riskImpact = text(requirement.riskImpact);
  const productRequirementDocument = text(requirement.productRequirementDocument);
  const remark = text(requirement.remark);
  const createdByName = text(requirement.createdByName);
  return {
    ...(requirement.priority ? { priority: requirement.priority } : {}),
    ...(functionalModule ? { functionalModule } : {}),
    ...(riskImpact ? { riskImpact } : {}),
    ...(productRequirementDocument ? { productRequirementDocument } : {}),
    ...(remark ? { remark } : {}),
    ...(createdByName ? { createdByName } : {}),
  };
}
