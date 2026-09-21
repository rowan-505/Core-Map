import { notFound } from "next/navigation";

import ReferenceDataPage from "@/src/features/reference-data/ReferenceDataPage";
import { isReferenceTypeKey } from "@/src/features/reference-data/registry";

export default async function ReferenceTypePage({
    params,
}: {
    params: Promise<{ type: string }>;
}) {
    const { type } = await params;
    if (!isReferenceTypeKey(type)) {
        notFound();
    }
    return <ReferenceDataPage type={type} />;
}
