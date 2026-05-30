// Gestion de l'état du pack actif (mode offline).

let activePackId: string | null = null;

export function getActivePackId(): string | null {
    return activePackId;
}

export function setActivePackId(id: string | null): void {
    activePackId = id;
}

export function isOfflineMode(): boolean {
    return activePackId !== null;
}
