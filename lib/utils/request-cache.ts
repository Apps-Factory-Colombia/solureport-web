type CacheEntry<T> = {
    value?: T;
    expiresAt: number;
    promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

export async function getCachedValue<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
): Promise<T> {
    const now = Date.now();
    const existing = cache.get(key) as CacheEntry<T> | undefined;

    if (existing?.value !== undefined && existing.expiresAt > now) {
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

export function invalidateCachedValue(key: string) {
    cache.delete(key);
}