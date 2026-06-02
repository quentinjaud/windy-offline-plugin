import { describe, it, expect, beforeEach, vi } from 'vitest';

// L'environnement Vitest est 'node' : pas de DOM, donc pas de localStorage natif.
// On installe un mock minimal en mémoire, partagé sur globalThis.
class LocalStorageMock {
    private store: Record<string, string> = {};
    getItem(key: string): string | null {
        return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
    }
    setItem(key: string, value: string): void {
        this.store[key] = String(value);
    }
    removeItem(key: string): void {
        delete this.store[key];
    }
    clear(): void {
        this.store = {};
    }
}

beforeEach(() => {
    vi.stubGlobal('localStorage', new LocalStorageMock());
    vi.resetModules();
});

describe('packState — persistance du pack actif', () => {
    it('restaure le pack actif après un reload (ré-import du module)', async () => {
        const first = await import('../src/lib/packState');
        first.setActivePackId('pack-123');

        // Simule un reload : le module est rechargé à neuf, mais localStorage persiste.
        vi.resetModules();
        const second = await import('../src/lib/packState');

        expect(second.getActivePackId()).toBe('pack-123');
    });

    it('la désactivation (null) survit aussi au reload', async () => {
        const first = await import('../src/lib/packState');
        first.setActivePackId('pack-123');
        first.setActivePackId(null);

        vi.resetModules();
        const second = await import('../src/lib/packState');

        expect(second.getActivePackId()).toBeNull();
        expect(second.isOfflineMode()).toBe(false);
    });

    it('vaut null par défaut quand rien n\'est stocké', async () => {
        const { getActivePackId, isOfflineMode } = await import('../src/lib/packState');
        expect(getActivePackId()).toBeNull();
        expect(isOfflineMode()).toBe(false);
    });

    it('ne lève pas et garde l\'état mémoire si localStorage est indisponible', async () => {
        // localStorage qui lève à chaque accès (mode privé, quota...)
        vi.stubGlobal('localStorage', {
            getItem() { throw new Error('unavailable'); },
            setItem() { throw new Error('unavailable'); },
            removeItem() { throw new Error('unavailable'); },
        });
        vi.resetModules();

        const { getActivePackId, setActivePackId } = await import('../src/lib/packState');
        expect(() => setActivePackId('pack-xyz')).not.toThrow();
        expect(getActivePackId()).toBe('pack-xyz');
    });
});
