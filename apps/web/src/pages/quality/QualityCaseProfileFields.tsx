import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import type { TestCaseProfileFields } from '../../types';
import { Field } from './quality-ui';

export const APPLICABLE_END_OPTIONS = [
  { key: 'phone', name: '手机端' },
  { key: 'glasses', name: '眼镜端' },
  { key: 'platform', name: '平台端' },
  { key: 'backend', name: '后台服务' },
];

const SCENARIO_TYPES = ['主流程', '入口发现', '双端联动', '三端联动', '兼容升级', '异常中断', '弱网/断连', '数据同步', '权限/鉴权', '长稳压测', '体验可用性', '风险回归'];
const CASE_TYPES = ['黑盒', '冒烟', '回归', '兼容', '升级', '异常', '长稳', '接口', '性能', '安全', '探索'];
const DEVICE_MODELS = ['全部', 'RG303', 'RG301', '其他'];
const AUTOMATION_STATUSES = ['是', '否', '部分', '待评估'];
const UNSET = '__unset__';

export interface CaseProfileForm {
  scenarioType: string;
  caseType: string;
  deviceModels: string[];
  applicableEnds: string[];
  traceId: string;
  purpose: string;
  passCriteria: string;
  failCriteria: string;
  automationStatus: string;
  remark: string;
}

export const emptyCaseProfile = (): CaseProfileForm => ({
  scenarioType: '',
  caseType: '',
  deviceModels: [],
  applicableEnds: [],
  traceId: '',
  purpose: '',
  passCriteria: '',
  failCriteria: '',
  automationStatus: '',
  remark: '',
});

export function caseProfileFromDefinition(value?: TestCaseProfileFields | null): CaseProfileForm {
  return {
    scenarioType: value?.scenarioType ?? '',
    caseType: value?.caseType ?? '',
    deviceModels: value?.deviceModels ?? [],
    applicableEnds: value?.applicableEnds ?? [],
    traceId: value?.traceId ?? '',
    purpose: value?.purpose ?? '',
    passCriteria: value?.passCriteria ?? '',
    failCriteria: value?.failCriteria ?? '',
    automationStatus: value?.automationStatus ?? '',
    remark: value?.remark ?? '',
  };
}

export function caseProfilePayload(value: CaseProfileForm): Omit<TestCaseProfileFields, 'deviceModels' | 'applicableEnds'> & {
  deviceModels: string[];
  applicableEnds: string[];
} {
  return {
    scenarioType: value.scenarioType || null,
    caseType: value.caseType || null,
    deviceModels: value.deviceModels,
    applicableEnds: value.applicableEnds,
    traceId: value.traceId.trim() || null,
    purpose: value.purpose.trim() || null,
    passCriteria: value.passCriteria.trim() || null,
    failCriteria: value.failCriteria.trim() || null,
    automationStatus: value.automationStatus || null,
    remark: value.remark.trim() || null,
  };
}

function optionsWithCurrent(options: string[], current: string) {
  return current && !options.includes(current) ? [current, ...options] : options;
}

function toggle(values: string[], key: string, checked: boolean) {
  return checked ? [...values, key] : values.filter((item) => item !== key);
}

export function QualityCaseProfileFields({
  value,
  onChange,
  disabled,
}: {
  value: CaseProfileForm;
  onChange: (value: CaseProfileForm) => void;
  disabled?: boolean;
}) {
  const deviceOptions = optionsWithCurrent(DEVICE_MODELS, '');
  const extraDevices = value.deviceModels.filter((item) => !DEVICE_MODELS.includes(item));
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="场景类型（可选）">
          <Select value={value.scenarioType || UNSET} disabled={disabled} onValueChange={(next) => onChange({ ...value, scenarioType: next === UNSET ? '' : next })}>
            <SelectTrigger aria-label="场景类型"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>未填写</SelectItem>
              {optionsWithCurrent(SCENARIO_TYPES, value.scenarioType).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="用例类型（可选）">
          <Select value={value.caseType || UNSET} disabled={disabled} onValueChange={(next) => onChange({ ...value, caseType: next === UNSET ? '' : next })}>
            <SelectTrigger aria-label="用例类型"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>未填写</SelectItem>
              {optionsWithCurrent(CASE_TYPES, value.caseType).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">适用端</legend>
        <div className="flex flex-wrap gap-4">
          {APPLICABLE_END_OPTIONS.map((end) => (
            <label key={end.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`适用端 ${end.name}`}
                checked={value.applicableEnds.includes(end.key)}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, applicableEnds: toggle(value.applicableEnds, end.key, event.target.checked) })}
              />
              {end.name}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">可多选。导入时双端会展开为手机端和眼镜端，三端再加平台端。</p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">适用机型</legend>
        <div className="flex flex-wrap gap-4">
          {[...deviceOptions, ...extraDevices].map((model) => (
            <label key={model} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`适用机型 ${model}`}
                checked={value.deviceModels.includes(model)}
                disabled={disabled}
                onChange={(event) => onChange({ ...value, deviceModels: toggle(value.deviceModels, model, event.target.checked) })}
              />
              {model}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="需求/追溯 ID（可选）">
          <Input aria-label="需求追溯 ID" value={value.traceId} disabled={disabled} onChange={(event) => onChange({ ...value, traceId: event.target.value })} />
        </Field>
        <Field label="是否可自动化（可选）">
          <Select value={value.automationStatus || UNSET} disabled={disabled} onValueChange={(next) => onChange({ ...value, automationStatus: next === UNSET ? '' : next })}>
            <SelectTrigger aria-label="是否可自动化"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>未填写</SelectItem>
              {optionsWithCurrent(AUTOMATION_STATUSES, value.automationStatus).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="测试目的（可选）">
        <Textarea aria-label="测试目的" rows={2} value={value.purpose} disabled={disabled} onChange={(event) => onChange({ ...value, purpose: event.target.value })} />
      </Field>
      <Field label="通过标准（可选）">
        <Textarea aria-label="通过标准" rows={2} value={value.passCriteria} disabled={disabled} onChange={(event) => onChange({ ...value, passCriteria: event.target.value })} />
      </Field>
      <Field label="失败判定（可选）">
        <Textarea aria-label="失败判定" rows={2} value={value.failCriteria} disabled={disabled} onChange={(event) => onChange({ ...value, failCriteria: event.target.value })} />
      </Field>
      <Field label="备注（可选）">
        <Textarea aria-label="备注" rows={2} value={value.remark} disabled={disabled} onChange={(event) => onChange({ ...value, remark: event.target.value })} />
      </Field>
    </div>
  );
}

export function applicableEndLabels(keys?: string[] | null) {
  return (keys ?? []).map((key) => APPLICABLE_END_OPTIONS.find((item) => item.key === key)?.name ?? key);
}
