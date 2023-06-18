export declare const LAVALINK_API_VERSION = 3;
export declare const SESSIONS: (sessionId: string) => string;
export declare const PLAYER: (sessionId: string, guildId: string) => string;
export declare const LOAD_TRACKS: (identifier: string) => string;
export declare const DECODE_TRACKS: () => string;
export declare const RECORDS: (guildId: string) => string;
export declare const RECORD: (guildId: string, id: string) => string;
export declare const ROUTE_PLANNER_STATUS: () => string;
export declare const ROUTE_PLANNER_FREE_ADDR: () => string;
export declare const ROUTE_PLANNER_FREE_ALL: () => string;
export declare const VERSION: () => string;
export declare const VERSIONS: () => string;
export declare const INFO: () => string;