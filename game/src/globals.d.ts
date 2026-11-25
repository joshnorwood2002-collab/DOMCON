// Compile-time constants injected by scripts/build.ts.
declare const __PLATFORM__: 'web' | 'itch' | 'portal' | 'crazygames' | 'gamedistribution';
declare const __VERSION__: string;
declare const __DEV__: boolean;
declare const __TITLE__: string;
/** Tip jar or store page link. Empty when the target forbids outbound links or none is configured. */
declare const __TIP_URL__: string;
declare const __GD_GAME_ID__: string;

// Stylesheets are bundled by esbuild; TypeScript only needs to know the import is allowed.
declare module '*.css';
