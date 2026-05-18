"use client";

import type { ServiceGroup } from "@/lib/services-canonical";

export default function FilterBar({
  sort,
  service,
  active7d,
  serviceGroups,
  activeCount,
  totalCount,
}: {
  sort: string;
  service: string;
  active7d: boolean;
  serviceGroups: ServiceGroup[];
  activeCount: number;
  totalCount: number;
}) {
  return (
    <form
      method="get"
      className="panel p-3 flex flex-wrap gap-3 items-center text-sm"
    >
      <input type="hidden" name="sort" value={sort} />

      <label className="flex items-center gap-2">
        <span className="text-muted text-xs">Service</span>
        <select
          name="service"
          defaultValue={service}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="bg-panel border border-edge rounded-md px-2 py-1 text-xs"
        >
          <option value="">All services</option>
          {serviceGroups.map((g) => (
            <option
              key={g.key}
              value={g.key}
              title={
                g.aliases.length > 1
                  ? `Matches: ${g.aliases.join(", ")}`
                  : undefined
              }
            >
              {g.display}
              {g.aliases.length > 1 ? ` (${g.aliases.length})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          name="active7d"
          value="1"
          defaultChecked={active7d}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <span className="text-xs">
          Active 7d
          <span className="badge badge-muted ml-2">
            {activeCount} of {totalCount}
          </span>
        </span>
      </label>

      {(service || active7d) && (
        <a
          href={`?sort=${sort}`}
          className="text-xs text-muted hover:text-ink underline"
        >
          clear filters
        </a>
      )}

      <noscript>
        <button
          type="submit"
          className="px-3 py-1 text-xs rounded-md border border-edge bg-panel hover:bg-edge"
        >
          Apply
        </button>
      </noscript>
    </form>
  );
}
