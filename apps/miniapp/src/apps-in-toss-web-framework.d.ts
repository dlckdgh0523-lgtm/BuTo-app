declare module "@apps-in-toss/web-framework" {
  export function appLogin(): Promise<{
    authorizationCode: string;
    referrer: "DEFAULT" | "SANDBOX";
  }>;

  export function appsInTossSignTossCert(params: {
    txId: string;
    skipConfirmDoc?: boolean;
  }): Promise<unknown>;

  export function getTossAppVersion(): Promise<string | undefined>;
}

declare module "@apps-in-toss/web-framework/config" {
  export function defineConfig<T>(config: T): T;
}
