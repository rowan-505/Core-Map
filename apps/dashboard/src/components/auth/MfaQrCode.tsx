"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type MfaQrCodeProps = {
    otpauthUrl: string;
    className?: string;
    size?: number;
};

/**
 * Renders a TOTP otpauth URL as a QR image in-browser.
 * Do not use third-party QR image APIs — the URL contains the MFA secret.
 */
export function MfaQrCode({ otpauthUrl, className, size = 180 }: MfaQrCodeProps) {
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setDataUrl(null);
        setFailed(false);

        void QRCode.toDataURL(otpauthUrl, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: size,
            color: {
                dark: "#0f172a",
                light: "#ffffff",
            },
        })
            .then((url) => {
                if (!cancelled) setDataUrl(url);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });

        return () => {
            cancelled = true;
        };
    }, [otpauthUrl, size]);

    if (failed) {
        return (
            <p className="text-xs text-amber-800">
                Could not render QR code. Use the secret below instead.
            </p>
        );
    }

    if (!dataUrl) {
        return (
            <div
                className={`flex items-center justify-center rounded-lg border border-slate-200 bg-white text-xs text-slate-500 ${className ?? ""}`}
                style={{ width: size, height: size }}
                aria-hidden
            >
                Preparing QR…
            </div>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element -- data URL from local QR generation
        <img
            src={dataUrl}
            alt="Authenticator QR code"
            width={size}
            height={size}
            className={`rounded-lg border border-slate-200 bg-white ${className ?? ""}`}
        />
    );
}
