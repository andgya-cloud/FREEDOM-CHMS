import { describe, expect, it } from 'vitest';
import { fileAdmissionKey, certificateEmailText, certificateFileName, certificatePath, looksLikePdf } from './certificateFiles.js';

describe('certificate files', () => {
  it('matches file names to admission numbers', () => {
    expect(fileAdmissionKey('ADIA-2025-014.pdf')).toBe(fileAdmissionKey('ADIA/2025/014'));
    expect(fileAdmissionKey('adia 2025 014.PDF')).toBe('adia2025014');
  });
  it('knows a PDF by its first bytes', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7\n'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('<html>'))).toBe(false);
  });
  it('names and stores the file', () => {
    expect(certificateFileName('Jane  Achieng', 'ADIA/2025/014')).toBe('Certificate - Jane Achieng - ADIA-2025-014.pdf');
    expect(certificateFileName('Jane', 'ADIA/ CTR/2025/1/002')).toBe('Certificate - Jane - ADIA-CTR-2025-1-002.pdf');
    expect(certificatePath('adia', 's1')).toBe('certificates/adia/s1.pdf');
  });
  it('writes a short congratulations', () => {
    const t = certificateEmailText({ studentName: 'Jane Achieng', programme: 'ICT', serial: 'ADIA-2025-001' });
    expect(t).toContain('Dear Jane');
    expect(t).toContain('ADIA-2025-001');
  });
});
