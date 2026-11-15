export interface paths {
    "/_allauth/{client}/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                client: "app" | "browser";
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    client: "app" | "browser";
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        email: string;
                        password: string;
                    };
                };
            };
            responses: {
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            status: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/_allauth/{client}/v1/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                client: "app" | "browser";
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    client: "app" | "browser";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    client: "app" | "browser";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
