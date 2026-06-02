// Gestion de l'état du pack actif (mode offline).
// Persisté dans localStorage pour survivre à un reload — c'est précisément le
// scénario hors-ligne : fermer puis rouvrir l'app sans réseau.

const STORAGE_KEY = 'windy-offline:activePackId';

function readStored(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

let activePackId: string | null = readStored();

export function getActivePackId(): string | null {
    return activePackId;
}

export function setActivePackId(id: string | null): void {
    activePackId = id;
    try {
        if (id === null) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, id);
        }
    } catch {
        // localStorage indisponible (mode privé, quota) — on garde l'état mémoire.
    }
}

export function isOfflineMode(): boolean {
    return activePackId !== null;
}
