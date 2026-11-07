/** Model provider marks shown in the homepage compatibility section. */
export const PROVIDERS: readonly {
  src: string;
  name: string;
  /** Optical width for a wordmark; square marks use the component default. */
  w?: number;
}[] = [
  { src: '/logos/providers/openai.svg', name: 'OpenAI' },
  { src: '/logos/providers/anthropic.svg', name: 'Anthropic' },
  { src: '/logos/providers/google.svg', name: 'Google' },
  { src: '/logos/providers/azure.svg', name: 'Azure OpenAI' },
  { src: '/logos/providers/bedrock.svg', name: 'Amazon Bedrock', w: 33 },
];
