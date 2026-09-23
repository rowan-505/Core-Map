import { coreReviewPath, transportPath } from "@/src/lib/dashboardPaths";

/** Core-review / transport detail URL for a name-pair entity. */
export function namePairDetailHref(args: {
  entityType: string;
  entityId: string;
  entityPublicId?: string | null;
}): string | null {
  const { entityType, entityId, entityPublicId } = args;
  const id = entityPublicId?.trim() || entityId;
  switch (entityType) {
    case "place":
      return coreReviewPath(`places/${id}/edit`);
    case "settlement":
      return coreReviewPath(`settlements/${id}/edit`);
    case "admin_area":
      return coreReviewPath(`admin-areas/${id}/edit`);
    case "street":
      return coreReviewPath(`roads/${id}/edit`);
    case "building":
      return coreReviewPath(`buildings/${id}/edit`);
    case "transport_stop":
      return entityPublicId ? transportPath(`stops/${entityPublicId}`) : null;
    case "transport_terminal":
      return entityPublicId ? transportPath(`terminals/${entityPublicId}`) : null;
    default:
      return null;
  }
}

export function formatEntityTypeLabel(entityType: string): string {
  return entityType.replaceAll("_", " ");
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
