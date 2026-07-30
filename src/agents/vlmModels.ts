/**
 * Vision-language models for receipt / document reading.
 * Heavier than classic OCR — most need network + free HF inference (GPU-backed).
 */
import type { AiId } from '../aiRoster'

export type VlmRunMode = 'remote-hf' | 'on-device-onnx'

export type VlmModelSpec = {
  aiId: AiId
  /** Hugging Face model id for Inference / router */
  hfModelId: string
  /** Alternate ids to try if primary fails */
  altHfModelIds?: string[]
  label: string
  notes: string
  /** Rough size class for UI */
  sizeHint: string
  /** Prefer earlier in the scan queue */
  priority: number
  mode: VlmRunMode
  /** Soft default-off for huge GPU models on phones */
  defaultDisabled?: boolean
}

/**
 * Ordered registry — higher priority runs first when multiple are enabled.
 */
export const VLM_MODELS: VlmModelSpec[] = [
  {
    aiId: 'smolvlm',
    hfModelId: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    altHfModelIds: ['HuggingFaceTB/SmolVLM-Instruct'],
    label: 'SmolVLM',
    notes: 'Smallest VLM family — lightest remote option; still heavy for mid phones on-device.',
    sizeHint: '~256M–2B',
    priority: 100,
    mode: 'remote-hf',
  },
  {
    aiId: 'rolmocr',
    hfModelId: 'reducto/RolmOCR',
    altHfModelIds: ['Qwen/Qwen2.5-VL-7B-Instruct'],
    label: 'RolmOCR',
    notes: 'Qwen fine-tune focused on OCR throughput — lighter VLM for documents.',
    sizeHint: '~7B OCR-tuned',
    priority: 90,
    mode: 'remote-hf',
  },
  {
    aiId: 'qwen25vl',
    hfModelId: 'Qwen/Qwen2.5-VL-7B-Instruct',
    altHfModelIds: ['Qwen/Qwen2.5-VL-3B-Instruct', 'Qwen/Qwen2.5-VL-72B-Instruct'],
    label: 'Qwen2.5-VL',
    notes: 'Top OCR/doc scores among open VLMs; multi-GB, GPU-oriented.',
    sizeHint: '3B–72B',
    priority: 80,
    mode: 'remote-hf',
  },
  {
    aiId: 'qwen3vl',
    hfModelId: 'Qwen/Qwen3-VL-4B-Instruct',
    altHfModelIds: ['Qwen/Qwen3-VL-8B-Instruct', 'Qwen/Qwen2.5-VL-7B-Instruct'],
    label: 'Qwen3-VL',
    notes: 'Next-gen Qwen vision-language — strong docs; multi-GB, GPU.',
    sizeHint: '4B+',
    priority: 75,
    mode: 'remote-hf',
  },
  {
    aiId: 'gotocr',
    hfModelId: 'stepfun-ai/GOT-OCR-2.0-hf',
    altHfModelIds: ['ucas-haoranwei/GOT-OCR2_0', 'stepfun-ai/GOT-OCR2_0'],
    label: 'GOT-OCR 2.0',
    notes: 'Strong general OCR transformer; GPU for practical speed.',
    sizeHint: 'GPU OCR',
    priority: 70,
    mode: 'remote-hf',
  },
  {
    aiId: 'internvl',
    hfModelId: 'OpenGVLab/InternVL2_5-1B',
    altHfModelIds: ['OpenGVLab/InternVL2-1B', 'OpenGVLab/InternVL2_5-2B'],
    label: 'InternVL-1B',
    notes: 'Small InternVL checkpoint — still heavy for mid phones; good doc VQA.',
    sizeHint: '~1–2B',
    priority: 65,
    mode: 'remote-hf',
  },
  {
    aiId: 'deepseekocr',
    hfModelId: 'deepseek-ai/DeepSeek-OCR',
    altHfModelIds: ['deepseek-ai/DeepSeek-OCR-2'],
    label: 'DeepSeek-OCR',
    notes: 'Strong document OCR / optical compression; GPU-oriented.',
    sizeHint: 'GPU docs',
    priority: 60,
    mode: 'remote-hf',
    defaultDisabled: true,
  },
]

export function getVlmSpec(aiId: AiId): VlmModelSpec | undefined {
  return VLM_MODELS.find((m) => m.aiId === aiId)
}

export function vlmAiIds(): AiId[] {
  return VLM_MODELS.map((m) => m.aiId)
}

/** VLMs that start disabled so first install stays snappy (user can enable). */
export function defaultDisabledVlmIds(): AiId[] {
  return VLM_MODELS.filter((m) => m.defaultDisabled).map((m) => m.aiId)
}

export const RECEIPT_VLM_PROMPT = `You are reading a store receipt or invoice photo.
Extract structured data. Reply with ONLY valid JSON (no markdown), shape:
{
  "vendor": "store or company name",
  "date": "YYYY-MM-DD or empty",
  "total": 0.00,
  "subtotal": 0.00 or null,
  "tax": 0.00 or null,
  "shipping": 0.00 or null,
  "fee": 0.00 or null,
  "items": [{"description": "product or service", "amount": 0.00}],
  "raw_text": "key lines transcribed from the page"
}
Rules:
- total is the grand total / amount due (required if visible)
- items are products/services only — not tax, total, subtotal, payment method
- use numbers not strings for money
- if a field is missing use null or empty string
- read carefully; do not invent items that are not on the page`
