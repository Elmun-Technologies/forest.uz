/** The part of jsdom's API the tests use (no @types/jsdom in the workspace). */
declare module 'jsdom' {
  export class CookieJar {
    setCookieSync(cookie: string, url: string): void;
  }
  export class JSDOM {
    constructor(html: string, options?: { url?: string; cookieJar?: CookieJar });
    readonly window: Window;
  }
}
