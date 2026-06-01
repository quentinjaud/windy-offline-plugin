import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-offline',
    version: '0.3.0',
    icon: '📡',
    title: 'Windy Offline',
    description: 'Télécharge les données météo pour consultation hors-ligne.',
    author: 'Quentin Jaud',
    repository: 'https://github.com/quentinjaud/windy-offline-plugin',
    desktopUI: 'rhpane',
    mobileUI: 'fullscreen',
    routerPath: '/offline',
    addToContextmenu: true,
};

export default config;
