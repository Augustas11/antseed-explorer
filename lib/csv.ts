export type CsvCell = string | number | boolean | null | undefined;

export function csvLine(fields: CsvCell[]): string {
  return fields
    .map((field) => {
      if (field == null) return "";
      let value = String(field);
      if (/^[=+\-@]/.test(value)) value = `'${value}`;
      if (/[,"\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    })
    .join(",");
}
