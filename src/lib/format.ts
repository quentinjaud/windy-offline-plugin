export function formatDate(dateOrIso: Date | string): string {
    const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatBBox(bbox: { n: number; s: number; e: number; w: number }): string {
    return `${bbox.n.toFixed(1)}°N · ${bbox.s.toFixed(1)}°S · ${bbox.e.toFixed(1)}°E · ${bbox.w.toFixed(1)}°W`;
}
