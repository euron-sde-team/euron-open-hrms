"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2 } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Avatar, AvatarFallback } from "@open-hrms/ui/avatar";
import { buildOrgTrees, type OrgNode, type OrgTreeNode } from "@/lib/org-tree";

interface OrgChartResponse {
  nodes: OrgNode[];
  roots: string[];
}

function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * One person in the chart.
 *
 * Sized to its contents rather than pinned to a fixed width. The card used to be `w-44` with
 * `truncate` on all three lines, so anything longer than about twenty characters (which is
 * most real designations, and plenty of names) was cut off mid-word with the rest only
 * available on hover. Names and job titles are the entire point of an org chart, so the card
 * grows to fit and wraps at a sensible maximum instead of hiding them.
 *
 * No border: the connector lines already describe the structure, and a box around every node
 * competed with them while visually capping how much text could sit inside.
 */
function NodeCard({ node }: { node: OrgNode }) {
  const reports = node.designation || "-";
  return (
    <div className="flex w-fit min-w-[9rem] max-w-[15rem] flex-col items-center rounded-lg bg-card px-3 py-3 text-center shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
      <Avatar size="lg">
        <AvatarFallback>{initials(node.name)}</AvatarFallback>
      </Avatar>
      <div className="mt-2 text-sm font-semibold leading-snug text-balance break-words">
        {node.name}
      </div>
      <div className="text-xs font-medium leading-snug text-primary text-balance break-words">
        {reports}
      </div>
      {node.department && node.department !== "-" && (
        <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground text-balance break-words">
          {node.department}
        </div>
      )}
    </div>
  );
}

/** Recursive <li> branch: a node card + a <ul> of its direct reports. */
function Branch({ item }: { item: OrgTreeNode }) {
  return (
    <li>
      <NodeCard node={item.node} />
      {item.children.length > 0 && (
        <ul>
          {item.children.map((child) => (
            <Branch key={child.node.id} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["org-chart"],
    queryFn: () => http.get<OrgChartResponse>("/directory/org-chart"),
  });

  // Memoised so the `?? []` fallback doesn't hand buildOrgTrees a new array every render.
  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const { trees, orphanTrees, cycleNodes, inTree } = useMemo(() => buildOrgTrees(nodes), [nodes]);
  const unplaced = orphanTrees.length + cycleNodes.length;

  /*
   * Start scrolled to the middle.
   *
   * The tree centres itself over a row far wider than the viewport, so at the browser's
   * default scrollLeft of 0 the visible area is the empty left margin and the organisation
   * root sits off-screen. The chart appeared to open on blank space with connector lines
   * arriving from nowhere.
   */
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || isLoading) return;
    // After layout, so scrollWidth reflects the rendered tree, not an empty container.
    const id = requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    });
    return () => cancelAnimationFrame(id);
  }, [isLoading, trees]);

  return (
    <>
      <PageHeader
        title="Org chart"
        description="Reporting hierarchy by position. Set each person's manager from Employees."
      />

      <Card>
        <div ref={scroller} className="overflow-x-auto px-2 py-2">
          {isLoading ? (
            <div className="flex justify-center gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-40" />
              ))}
            </div>
          ) : trees.length === 0 && unplaced === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No reporting structure set yet. Assign managers from the Employees screen.
            </div>
          ) : (
            // A single company root unifies every top-level person into one tree.
            <ul className="org-tree min-w-max">
              <li>
                <div className="flex w-fit min-w-[11rem] max-w-[17rem] flex-col items-center rounded-lg bg-[var(--accent-50)] px-3 py-3 text-center shadow-sm ring-1 ring-primary/15">
                  <div className="grid h-10 w-10 place-items-center rounded-[6px] bg-primary text-primary-foreground">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="mt-2 text-sm font-bold leading-snug text-balance break-words">{user?.org?.name || "Organisation"}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {/* Count what is actually drawn, not the raw list: the two
                        disagreed whenever anyone was unreachable. */}
                    {unplaced > 0 ? `${inTree} of ${nodes.length} people` : `${nodes.length} people`}
                  </div>
                </div>
                <ul>
                  {trees.map((item) => (
                    <Branch key={item.node.id} item={item} />
                  ))}
                </ul>
              </li>
            </ul>
          )}
        </div>
      </Card>

      {/* Anyone the tree cannot reach used to vanish here without a trace. Show them
          with the reason so the gap is actionable rather than invisible. */}
      {!isLoading && unplaced > 0 && (
        <Card className="mt-5">
          <div className="px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-[color:var(--warn)]" />
              <h2 className="text-[15px] font-semibold">
                Not in the reporting line ({unplaced})
              </h2>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              These people are not connected to the hierarchy above. Set their manager from the
              Employees screen to place them.
            </p>

            {orphanTrees.length > 0 && (
              <div className="mt-4">
                <div className="text-[13px] font-medium">
                  Manager has exited or was removed ({orphanTrees.length})
                </div>
                <div className="mt-2 overflow-x-auto">
                  <ul className="org-tree min-w-max">
                    {orphanTrees.map((item) => (
                      <Branch key={item.node.id} item={item} />
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {cycleNodes.length > 0 && (
              <div className="mt-4">
                <div className="text-[13px] font-medium">
                  Circular reporting line ({cycleNodes.length})
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {cycleNodes.map((n) => (
                    <NodeCard key={n.id} node={n} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
