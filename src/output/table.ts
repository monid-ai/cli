import { Table, Column, type Direction } from '@cliffy/table';

export interface ColumnConfig {
  align?: Direction;
}

/**
 * Render a simple table with headers and rows.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
  options?: { border?: boolean; columns?: Record<number, ColumnConfig> },
): void {
  const table = new Table()
    .header(headers)
    .body(rows)
    .border(options?.border ?? false)
    .padding(1);

  if (options?.columns) {
    for (const [index, config] of Object.entries(options.columns)) {
      const col = new Column();
      if (config.align) col.align(config.align);
      table.column(Number(index), col);
    }
  }

  console.log(table.toString());
}
