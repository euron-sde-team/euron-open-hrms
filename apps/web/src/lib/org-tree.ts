// GET /api/directory/org-chart returns a flat list of nodes + the ids of the roots
// (people with no manager). managerId encodes the reporting line.
export interface OrgNode {
  id: string;
  name: string;
  code?: string;
  designation: string;
  department: string;
  employmentType?: string;
  managerId: string | null;
  email?: string;
}

export interface OrgTreeNode {
  node: OrgNode;
  children: OrgTreeNode[];
}

export interface OrgTrees {
  /** Hierarchies rooted at people with no manager. */
  trees: OrgTreeNode[];
  /** Sub-hierarchies whose top person points at a manager who no longer exists. */
  orphanTrees: OrgTreeNode[];
  /** People trapped in a reporting cycle, so unreachable from any root. */
  cycleNodes: OrgNode[];
  /** How many people the main trees actually contain. */
  inTree: number;
}

/**
 * Turn the flat node list into trees, and account for everyone the tree cannot reach.
 *
 * Unreachable people used to disappear from the chart while still being counted in the
 * headcount, which made the chart quietly wrong. Two ways it happens:
 *
 *  - orphans   the manager has exited or was deleted, so managerId points at nobody.
 *              The API filters out EXITED employees, so their reports lose their parent.
 *  - cycles    A reports to B reports to A. Neither is a root (both have a managerId),
 *              so neither is reachable from any root.
 *
 * Building parent -> children once also drops the previous O(n^2) filter-per-node.
 */
export function buildOrgTrees(nodes: OrgNode[]): OrgTrees {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, OrgNode[]>();
  const roots: OrgNode[] = [];
  const orphans: OrgNode[] = [];

  for (const n of nodes) {
    // Self-reference is a cycle of one; treat it as unreachable rather than a root.
    if (!n.managerId) {
      roots.push(n);
    } else if (!byId.has(n.managerId)) {
      orphans.push(n);
    } else {
      const siblings = childrenOf.get(n.managerId);
      if (siblings) siblings.push(n);
      else childrenOf.set(n.managerId, [n]);
    }
  }

  // `visited` is shared across the whole build, so nobody renders twice and a cycle
  // can never recurse forever even if a cycle member somehow became a root.
  const visited = new Set<string>();
  const expand = (node: OrgNode): OrgTreeNode => {
    visited.add(node.id);
    const kids = (childrenOf.get(node.id) ?? []).filter((c) => !visited.has(c.id));
    return { node, children: kids.map(expand) };
  };

  const trees = roots.map(expand);
  const inTree = visited.size; // counted before orphans, so it reflects the real hierarchy
  const orphanTrees = orphans.map(expand);
  const cycleNodes = nodes.filter((n) => !visited.has(n.id));

  return { trees, orphanTrees, cycleNodes, inTree };
}
