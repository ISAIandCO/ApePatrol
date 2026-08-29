export class TableListTools {
  constructor(client) { this.client = client; }
  async list(signal) { return this.client.getTableLists({ signal }); }
  preview(operation, table, row) {
    if (!["add", "remove"].includes(operation)) throw new TypeError("Unsupported table-list operation");
    if (!table?.token && !table?.id) throw new TypeError("Table list token is missing");
    if (!Array.isArray(row) || row.length === 0) throw new TypeError("Table-list row must be a non-empty array");
    return { operation, token: String(table.token ?? table.id), tableName: String(table.name ?? table.displayName ?? table.id), row: structuredClone(row) };
  }
}
