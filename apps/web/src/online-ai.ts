import { useEffect, useState } from 'react';
import { api } from './api';
import type { OnlineAiProviders } from './types';

export const ONLINE_AI_UNAVAILABLE_MESSAGE = '当前组织未配置 AI 凭据，在线 AI 不可用。请先在 AI 凭据中配置。';

export function normalizeOnlineAiProviders(policy: {
  defaultProvider: 'codex' | 'cursor' | null;
  onlineAvailable?: boolean;
  providers?: Array<{ id: 'codex' | 'cursor'; label: string }>;
}): OnlineAiProviders {
  const providers = policy.providers ?? [];
  const onlineAvailable = policy.onlineAvailable ?? providers.length > 0;
  const defaultProvider = onlineAvailable && policy.defaultProvider && providers.some((item) => item.id === policy.defaultProvider)
    ? policy.defaultProvider
    : onlineAvailable
      ? providers[0]?.id ?? null
      : null;
  return {
    defaultProvider,
    onlineAvailable: onlineAvailable && providers.length > 0,
    providers: onlineAvailable ? providers : [],
  };
}

export function useOnlineAiProviders() {
  const [policy, setPolicy] = useState<OnlineAiProviders | null>(null);

  useEffect(() => {
    if (typeof api.getWorkflowProviders !== 'function') {
      return;
    }
    let cancelled = false;
    void api.getWorkflowProviders()
      .then((next) => {
        if (!cancelled) setPolicy(normalizeOnlineAiProviders(next));
      })
      .catch(() => {
        if (!cancelled) {
          setPolicy({ defaultProvider: null, onlineAvailable: false, providers: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return policy;
}
