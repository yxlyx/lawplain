import type { McpActivity } from "@/server/mcp-store";

export function McpActivityTable({
  activity,
  users,
}: {
  activity: McpActivity[];
  users?: Record<string, string>;
}) {
  if (!activity.length)
    return <p className="py-5 text-sm text-muted-2">No MCP activity yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Recent MCP requests</caption>
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">
              When
            </th>
            {users && (
              <th scope="col" className="px-4 py-3">
                Account
              </th>
            )}
            <th scope="col" className="px-4 py-3">
              Connection
            </th>
            <th scope="col" className="px-4 py-3">
              Operation
            </th>
            <th scope="col" className="px-4 py-3">
              Outcome
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Time
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {activity.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                <time dateTime={new Date(row.createdAt).toISOString()}>
                  {new Date(row.createdAt).toLocaleString()}
                </time>
              </td>
              {users && (
                <td
                  className="max-w-52 truncate px-4 py-3"
                  title={users[row.userId] ?? row.userId}
                >
                  {users[row.userId] ?? row.userId}
                </td>
              )}
              <td
                className="max-w-40 truncate px-4 py-3 text-xs text-muted"
                title={row.keyName}
              >
                {row.keyName}
              </td>
              <td className="px-4 py-3 font-mono text-xs">{row.operation}</td>
              <td
                className={`px-4 py-3 text-xs ${row.outcome === "success" ? "text-accent" : "text-muted"}`}
              >
                {row.outcome.replaceAll("_", " ")}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted">
                {row.durationMs} ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
