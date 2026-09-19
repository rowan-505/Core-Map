"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
    upsertPlaceContact,
    type PlaceContact,
    type PlaceDetail,
    type PlacePrimaryAddress,
} from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardPaths";

const INPUT_CLASS =
    "w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50";
const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";

export type PlaceContactAddressPanelProps = {
    place: PlaceDetail;
    reload: () => Promise<void>;
    disabled?: boolean;
};

function emptyContact(): PlaceContact {
    return {
        phone: null,
        website: null,
        facebook_url: null,
        email: null,
        opening_hours: null,
    };
}

export default function PlaceContactAddressPanel({
    place,
    reload,
    disabled = false,
}: PlaceContactAddressPanelProps) {
    const [contact, setContact] = useState<PlaceContact>(place.contact ?? emptyContact());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setContact(place.contact ?? emptyContact());
    }, [place.contact, place.public_id]);

    const address: PlacePrimaryAddress | null = place.primary_address ?? null;

    const onSaveContact = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const next = await upsertPlaceContact(place.public_id, {
                phone: contact.phone,
                website: contact.website,
                facebookUrl: contact.facebook_url,
                email: contact.email,
                openingHours: contact.opening_hours,
            });
            setContact(next);
            setSaved(true);
            await reload();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Could not save contact");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <section className="space-y-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Contact & opening hours</h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                        Stored in core.core_place_contacts (not in place JSON fields).
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                        <span className="text-xs font-medium text-gray-600">Phone</span>
                        <input
                            className={INPUT_CLASS}
                            disabled={disabled || saving}
                            value={contact.phone ?? ""}
                            onChange={(e) =>
                                setContact((c) => ({ ...c, phone: e.target.value || null }))
                            }
                        />
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="text-xs font-medium text-gray-600">Email</span>
                        <input
                            className={INPUT_CLASS}
                            disabled={disabled || saving}
                            value={contact.email ?? ""}
                            onChange={(e) =>
                                setContact((c) => ({ ...c, email: e.target.value || null }))
                            }
                        />
                    </label>
                    <label className="space-y-1 text-sm sm:col-span-2">
                        <span className="text-xs font-medium text-gray-600">Website</span>
                        <input
                            className={INPUT_CLASS}
                            disabled={disabled || saving}
                            placeholder="https://"
                            value={contact.website ?? ""}
                            onChange={(e) =>
                                setContact((c) => ({ ...c, website: e.target.value || null }))
                            }
                        />
                    </label>
                    <label className="space-y-1 text-sm sm:col-span-2">
                        <span className="text-xs font-medium text-gray-600">Facebook URL</span>
                        <input
                            className={INPUT_CLASS}
                            disabled={disabled || saving}
                            placeholder="https://"
                            value={contact.facebook_url ?? ""}
                            onChange={(e) =>
                                setContact((c) => ({
                                    ...c,
                                    facebook_url: e.target.value || null,
                                }))
                            }
                        />
                    </label>
                    <label className="space-y-1 text-sm sm:col-span-2">
                        <span className="text-xs font-medium text-gray-600">Opening hours</span>
                        <textarea
                            className={INPUT_CLASS}
                            rows={3}
                            disabled={disabled || saving}
                            value={contact.opening_hours ?? ""}
                            onChange={(e) =>
                                setContact((c) => ({
                                    ...c,
                                    opening_hours: e.target.value || null,
                                }))
                            }
                        />
                    </label>
                </div>
                {error ? <p className="text-sm text-red-700">{error}</p> : null}
                {saved ? <p className="text-sm text-emerald-700">Contact saved.</p> : null}
                <button
                    type="button"
                    className={PRIMARY_BTN}
                    disabled={disabled || saving}
                    onClick={() => void onSaveContact()}
                >
                    {saving ? "Saving…" : "Save contact"}
                </button>
            </section>

            <section className="space-y-2 border-t border-gray-100 pt-4">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Address</h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                        Linked via core.core_place_addresses → core.core_addresses.
                    </p>
                </div>
                {address ? (
                    <div className="space-y-2 text-sm text-gray-800">
                        <p className="font-medium">{address.full_address}</p>
                        <p className="text-xs text-gray-500">
                            {[
                                address.house_number,
                                address.street_name,
                                address.quarter,
                                address.township,
                                address.city,
                                address.state_region,
                                address.postal_code,
                            ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                        </p>
                        <Link
                            href={coreReviewPath(`addresses/${address.public_id}/edit`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex text-xs font-medium text-gray-900 underline"
                        >
                            Edit linked address ↗
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-2 text-sm text-gray-600">
                        <p>No linked address yet.</p>
                        <Link
                            href={coreReviewPath("addresses/new")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={SECONDARY_BTN}
                        >
                            Create address ↗
                        </Link>
                    </div>
                )}
            </section>
        </div>
    );
}
