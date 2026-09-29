// Proof-owned inventory and requests; never imported by the application.
export interface Backup {
  id: string;
  location: string;
  created_at: string;
  size_gb: number;
  retain?: boolean;
}
export const inventory: Backup[] = [
  {
    id: 'proof-delete',
    location: 'demo://delete',
    created_at: '2025-01-01',
    size_gb: 2.5,
  },
  {
    id: 'proof-keep',
    location: 'demo://keep',
    created_at: '2025-01-02',
    size_gb: 3,
  },
  {
    id: 'proof-retained',
    location: 'demo://retained',
    created_at: '2025-01-03',
    size_gb: 4,
    retain: true,
  },
];
export const scenarios = ['approve', 'decline', 'empty'] as const;
export type Scenario = (typeof scenarios)[number];
export const prompts: Record<Scenario, string> = {
  approve:
    'For the owned approval proof, delete only proof-delete. Ask for approval before deleting it.',
  decline:
    'For the owned decline proof, delete only proof-delete. Ask for approval before deleting it.',
  empty:
    'For the owned empty-inventory proof, delete only proof-delete. Ask for approval before deleting it.',
};
export const listPrompt =
  'List all remaining backups for the owned empty-inventory proof.';
export const title = (scenario: Scenario) =>
  'Owned native backup effect: ' + scenario;
export const seed = (scenario: Scenario): Backup[] =>
  structuredClone(scenario === 'empty' ? inventory.slice(0, 1) : inventory);
export const remaining = (scenario: Scenario): Backup[] =>
  scenario === 'decline' ? seed(scenario) : seed(scenario).slice(1);
export const deletionResult = (scenario: Scenario) =>
  scenario === 'decline'
    ? { deleted: [], declined: true, human_response: 'denied', remaining: 3 }
    : {
        deleted: ['proof-delete'],
        freed_gb: 2.5,
        remaining: scenario === 'empty' ? 0 : 2,
      };
export const emptyListResult = { older_than_days: 0, backups: [], total: 0 };
