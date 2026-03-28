type CacheEntry<T> = {
    value?: T;
    expiresAt: number;
    promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

function isFresh(entry: CacheEntry<unknown> | undefined, now = Date.now()) {
    return entry?.value !== undefined && entry.expiresAt > now;
}

export async function getCachedValue<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
): Promise<T> {
    const now = Date.now();
    const existing = cache.get(key) as CacheEntry<T> | undefined;

    if (isFresh(existing, now)) {
        return existing.value;
    }

    if (existing?.promise) {
        return existing.promise;
    }

    const promise = loader()
        .then((value) => {
            cache.set(key, {
                value,
                expiresAt: Date.now() + ttlMs,
            });
            return value;
        })
        .catch((error) => {
            cache.delete(key);
            throw error;
        });

    cache.set(key, {
        value: existing?.value,
        expiresAt: existing?.expiresAt || 0,
        promise,
    });

    return promise;
}

export function peekCachedValue<T>(
    key: string,
    options?: { allowExpired?: boolean }
): T | undefined {
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (!entry?.value) {
        return undefined;
    }

    if (options?.allowExpired || isFresh(entry)) {
        return entry.value;
    }

    return undefined;
}

export function hasFreshCachedValue(key: string): boolean {
    return isFresh(cache.get(key));
}

export function invalidateCachedValue(key: string) {
    cache.delete(key);
}

export function invalidateCachedValues(keys: string[]) {
    keys.forEach((key) => cache.delete(key));
}