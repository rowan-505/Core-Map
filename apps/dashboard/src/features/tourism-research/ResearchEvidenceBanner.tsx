"use client";

import type { TourismResearchPrefillResponse } from "./types";

type Props = {
  prefill: TourismResearchPrefillResponse;
};

/** Advisory research panel shown on production forms during Review & Add. */
export default function ResearchEvidenceBanner({ prefill }: Props) {
  const evidence = prefill.candidate.evidence;
  const sources = evidence?.sources ?? [];

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <div className="font-medium">Research evidence (advisory only)</div>
      <p className="mt-1">
        {evidence?.description ?? evidence?.short_description ?? prefill.candidate.name}
      </p>
      {sources.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {sources.map((source, index) => (
            <li key={`${String(source.url ?? "src")}-${index}`}>
              {typeof source.url === "string" ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {typeof source.title === "string" ? source.title : source.url}
                </a>
              ) : typeof source.title === "string" ? (
                source.title
              ) : (
                "Source"
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence?.uncertainties && evidence.uncertainties.length > 0 ? (
        <div className="mt-2 text-xs">
          <span className="font-medium">Uncertainty: </span>
          {evidence.uncertainties.join("; ")}
        </div>
      ) : null}
      {evidence?.conflicts && evidence.conflicts.length > 0 ? (
        <div className="mt-1 text-xs">
          <span className="font-medium">Conflicts: </span>
          {evidence.conflicts.join("; ")}
        </div>
      ) : null}
      <p className="mt-2 text-xs">
        Reference scores are suggestions only. They do not overwrite production
        importance, popularity, or ranking fields.
      </p>
    </div>
  );
}
