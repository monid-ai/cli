import { Table } from '@cliffy/table';

/**
 * Render a simple table with headers and rows.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
): void {
  const table = new Table()
    .header(headers)
    .body(rows)
    .border()
    .padding(1);

  console.log(table.toString());
}
