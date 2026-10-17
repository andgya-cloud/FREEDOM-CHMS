export const ORGANIZATION_TYPES = ['church_campus', 'college', 'ministry'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  church_campus: 'Church campus',
  college: 'College',
  ministry: 'Ministry',
};

export interface OrganizationInput {
  name: string;
  type: OrganizationType;
  parentId: string | null;
  timeZone: string;
  currency: string;
  receiptPrefix: string;
}

/** Returns a list of problems in plain English; empty means the organization is valid. */
export function organizationProblems(org: Partial<OrganizationInput>): string[] {
  const problems: string[] = [];
  if (!org.name || org.name.trim().length < 2) problems.push('Enter the organization name.');
  if (!org.type || !ORGANIZATION_TYPES.includes(org.type)) problems.push('Choose a type.');
  if (!org.receiptPrefix || !/^[A-Z]{2,6}$/.test(org.receiptPrefix)) {
    problems.push('Receipt prefix must be 2 to 6 capital letters, for example FCN.');
  }
  if (!org.currency || !/^[A-Z]{3}$/.test(org.currency)) problems.push('Currency must be a 3-letter code such as KES.');
  if (!org.timeZone) problems.push('Choose a time zone.');
  return problems;
}

/** Suggests a receipt prefix from a name: "Freedom Church Nairobi" -> "FCN". */
export function suggestReceiptPrefix(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => w && !/^(of|the|and|&)$/i.test(w))
    .map((w) => w[0]!.toUpperCase())
    .filter((c) => /[A-Z]/.test(c))
    .join('');
  return letters.slice(0, 6);
}
