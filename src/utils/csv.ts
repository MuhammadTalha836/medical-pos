// Downloads rows as a CSV file the store can open in Excel. Every value is quoted, so commas and quotes are safe.

export type CsvValue = string | number | null | undefined;

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]): void {
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
