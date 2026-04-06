import { Table } from '@cliffy/table';

/**
 * Render a simple table with headers and rows.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
  border: boolean = false
): void {
  const table = new Table()
    .header(headers)
    .body(rows)
    .border(border)
    .padding(1) ;

  console.log(table.toString());
}
