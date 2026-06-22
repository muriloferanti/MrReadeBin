const STORAGE_KEY = 'mrreadebin_ai_settings';

export const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    baseUrl: 'https://api.anthropic.com/v1',
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash-preview-05-20', 'gemini-1.5-pro'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  openai_compat: {
    label: 'Compatível OpenAI (Groq, LM Studio…)',
    defaultModel: '',
    models: [],
    baseUrl: '',
  },
};

const DEFAULTS = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  baseUrl: '',
};

export function loadAiSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAiSettings(settings) {
  const clean = {
    provider: settings.provider || DEFAULTS.provider,
    apiKey: settings.apiKey || '',
    model: settings.model || AI_PROVIDERS[settings.provider]?.defaultModel || '',
    baseUrl: settings.baseUrl || '',
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function clearAiSettings() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isAiConfigured(settings = loadAiSettings()) {
  if (!settings.apiKey?.trim()) return false;
  if (settings.provider === 'openai_compat' && !settings.baseUrl?.trim()) return false;
  return true;
}

export function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || AI_PROVIDERS.openai;
}
