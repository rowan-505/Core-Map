/**
 * Privacy-safe bootstrap probes. Never log geometry, tokens, credentials, or bodies.
 */

export type FieldBootstrapMemorySample = {
    label: string;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    elapsedMs: number;
};

export type FieldBootstrapMetricSink = (event: Record<string, string | number | boolean>) => void;

export function sampleMemory(label: string, startedAtMs: number): FieldBootstrapMemorySample {
    const memory = process.memoryUsage();
    return {
        label,
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        elapsedMs: Date.now() - startedAtMs,
    };
}

export function createPeakTracker(startedAtMs: number) {
    let peakRss = 0;
    let peakHeapUsed = 0;
    let peakLabel = "start";
    const samples: FieldBootstrapMemorySample[] = [];

    return {
        sample(label: string): FieldBootstrapMemorySample {
            const next = sampleMemory(label, startedAtMs);
            samples.push(next);
            if (next.rss >= peakRss) {
                peakRss = next.rss;
                peakHeapUsed = next.heapUsed;
                peakLabel = label;
            }
            return next;
        },
        summary() {
            return {
                peakRss,
                peakHeapUsed,
                peakLabel,
                samples,
            };
        },
    };
}

export function emitFieldBootstrapMetric(
    sink: FieldBootstrapMetricSink | undefined,
    event: Record<string, string | number | boolean>
): void {
    if (!sink) {
        return;
    }
    sink(event);
}

export function stderrMetricSink(event: Record<string, string | number | boolean>): void {
    process.stderr.write(`${JSON.stringify({ kind: "field_bootstrap_metric", ...event })}\n`);
}

export function fieldBootstrapMetricsEnabled(): boolean {
    return process.env.FIELD_BOOTSTRAP_METRICS === "true";
}
